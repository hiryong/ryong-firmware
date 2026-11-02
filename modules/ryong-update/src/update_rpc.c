/* SPDX-License-Identifier: MIT */
#include <errno.h>
#include <string.h>
#include <pb_decode.h>
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zmk/behavior.h>
#include <zmk/endpoints.h>
#include <zmk/usb.h>
#include <zmk/studio/custom.h>
#include <ryong/update.pb.h>

BUILD_ASSERT(sizeof(CONFIG_RYONG_UPDATE_MODEL) <= 40);
BUILD_ASSERT(sizeof(CONFIG_RYONG_UPDATE_BUILD_ID) <= 65);
static struct zmk_rpc_custom_subsystem_meta meta = {.security = ZMK_STUDIO_RPC_HANDLER_SECURED};
static bool handle(const zmk_custom_CallRequest *request, pb_callback_t *response);
ZMK_RPC_CUSTOM_SUBSYSTEM(ryong__firmware_update, &meta, handle);
ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(ryong__firmware_update, ryong_update_Response);
static struct zmk_rpc_custom_subsystem_meta identity_meta = {.security = ZMK_STUDIO_RPC_HANDLER_UNSECURED};
static bool identity_handle(const zmk_custom_CallRequest *request, pb_callback_t *response);
ZMK_RPC_CUSTOM_SUBSYSTEM(ryong__firmware_identity, &identity_meta, identity_handle);
ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(ryong__firmware_identity, ryong_update_Response);
static void fill_identity(ryong_update_Response *response) {
    response->which_response_type=ryong_update_Response_identity_tag;
    memset(&response->response_type.identity,0,sizeof(response->response_type.identity));
    strncpy(response->response_type.identity.model,CONFIG_RYONG_UPDATE_MODEL,sizeof(response->response_type.identity.model)-1);
    strncpy(response->response_type.identity.build_id,CONFIG_RYONG_UPDATE_BUILD_ID,sizeof(response->response_type.identity.build_id)-1);
    response->response_type.identity.version=CONFIG_RYONG_UPDATE_VERSION;
    response->response_type.identity.bootloader_allowed=IS_ENABLED(CONFIG_RYONG_UPDATE_BOOTLOADER_ALLOWED);
}
/* Deliberately public, read-only identity confirms reboot while Studio is locked.
 * No settings, peer addresses or mutation command is exposed. */
static bool identity_handle(const zmk_custom_CallRequest *raw, pb_callback_t *encoded) {
    ryong_update_Response *response=ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(ryong__firmware_identity,encoded);
    ryong_update_Request request=ryong_update_Request_init_zero;
    pb_istream_t stream=pb_istream_from_buffer(raw->payload.bytes,raw->payload.size);
    response->which_response_type=ryong_update_Response_status_tag;
    response->response_type.status.ok=false;response->response_type.status.error=EPERM;
    if(pb_decode(&stream,ryong_update_Request_fields,&request)&&request.which_request_type==ryong_update_Request_identity_tag)fill_identity(response);
    return true;
}
static struct k_spinlock lock;
static uint8_t nonce[16];
static int64_t expires;
static bool prepared;
static bool usb_ready(void) {
    return zmk_endpoint_get_selected().transport == ZMK_TRANSPORT_USB && zmk_usb_is_hid_ready();
}
static void enter_bootloader(struct k_work *work) {
    ARG_UNUSED(work);
#if DT_NODE_EXISTS(DT_NODELABEL(bootloader))
    if (!IS_ENABLED(CONFIG_RYONG_UPDATE_BOOTLOADER_ALLOWED) || !usb_ready()) return;
    struct zmk_behavior_binding binding = {.behavior_dev = DEVICE_DT_NAME(DT_NODELABEL(bootloader))};
    struct zmk_behavior_binding_event event = {.position = 0, .timestamp = k_uptime_get()};
    (void)zmk_behavior_invoke_binding(&binding, event, true);
#endif
}
static K_WORK_DELAYABLE_DEFINE(reboot_work, enter_bootloader);
static bool handle(const zmk_custom_CallRequest *raw, pb_callback_t *encoded) {
    ryong_update_Response *response=ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(ryong__firmware_update, encoded);
    ryong_update_Request request=ryong_update_Request_init_zero;
    pb_istream_t stream=pb_istream_from_buffer(raw->payload.bytes,raw->payload.size);
    response->which_response_type=ryong_update_Response_status_tag;
    response->response_type.status.ok=false;
    response->response_type.status.error=EINVAL;
    if(!pb_decode(&stream,ryong_update_Request_fields,&request))return true;
    if(request.which_request_type==ryong_update_Request_identity_tag){
        fill_identity(response);
        return true;
    }
    if(!IS_ENABLED(CONFIG_RYONG_UPDATE_BOOTLOADER_ALLOWED)||!usb_ready()){
        response->response_type.status.error=EPERM;return true;
    }
    k_spinlock_key_t key=k_spin_lock(&lock);
    if(request.which_request_type==ryong_update_Request_prepare_tag){
        const ryong_update_Prepare *p=&request.request_type.prepare;
        if(p->nonce.size==sizeof nonce&&!strcmp(p->expected_build_id,CONFIG_RYONG_UPDATE_BUILD_ID)){
            memcpy(nonce,p->nonce.bytes,sizeof nonce);expires=k_uptime_get()+30000;prepared=true;
            response->response_type.status.ok=true;response->response_type.status.error=0;
        }
    }else if(request.which_request_type==ryong_update_Request_confirm_tag){
        const ryong_update_Confirm *p=&request.request_type.confirm;
        bool valid=prepared&&k_uptime_get()<expires&&p->nonce.size==sizeof nonce&&!memcmp(nonce,p->nonce.bytes,sizeof nonce);
        prepared=false;memset(nonce,0,sizeof nonce);
        if(valid){
            int rc=k_work_reschedule(&reboot_work,K_MSEC(500));
            response->response_type.status.ok=rc>=0;response->response_type.status.error=rc<0?(uint32_t)-rc:0;
        }
    }
    k_spin_unlock(&lock,key);
    return true;
}
