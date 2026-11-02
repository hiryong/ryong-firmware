"""Execute actual update RPC controller with host stubs; never reboot hardware."""
from pathlib import Path
import os,subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
HEADER=r'''
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <errno.h>
#define CONFIG_RYONG_UPDATE_MODEL "test-model"
#define CONFIG_RYONG_UPDATE_BUILD_ID "test-build"
#define CONFIG_RYONG_UPDATE_VERSION 3
#define LOG_MODULE_DECLARE(a,b)
#define BUILD_ASSERT(x) _Static_assert(x,#x)
#define IS_ENABLED(x) (x)
#define ARG_UNUSED(x) ((void)(x))
#define DT_NODELABEL(x) 1
#define DT_NODE_EXISTS(x) 1
#define DEVICE_DT_NAME(x) "bootloader"
#define K_MSEC(x) (x)
struct k_work {int unused;};
struct k_spinlock {int unused;};
typedef int k_spinlock_key_t;
static int64_t now;
static int scheduled;
static bool usb=true;
static k_spinlock_key_t k_spin_lock(struct k_spinlock *l){(void)l;return 0;}
static void k_spin_unlock(struct k_spinlock *l,int key){(void)l;(void)key;}
static int64_t k_uptime_get(void){return now;}
static int k_work_reschedule(struct k_work *w,int delay){(void)w;(void)delay;scheduled++;return 0;}
#define K_WORK_DELAYABLE_DEFINE(n,fn) struct k_work n; static void (*n##_callback)(struct k_work*) __attribute__((unused))=fn
struct zmk_behavior_binding {const char *behavior_dev;};
struct zmk_behavior_binding_event {uint32_t position;int64_t timestamp;};
static int zmk_behavior_invoke_binding(const struct zmk_behavior_binding *b,struct zmk_behavior_binding_event e,bool p){(void)b;(void)e;(void)p;return 0;}
#define ZMK_TRANSPORT_USB 1
struct endpoint {int transport;};
static struct endpoint zmk_endpoint_get_selected(void){return (struct endpoint){usb?1:0};}
static bool zmk_usb_is_hid_ready(void){return usb;}
#define ZMK_STUDIO_RPC_HANDLER_SECURED 1
#define ZMK_STUDIO_RPC_HANDLER_UNSECURED 0
struct zmk_rpc_custom_subsystem_meta {int security;};
typedef struct {int unused;} pb_callback_t;
typedef struct {size_t size;uint8_t bytes[160];} Bytes;
typedef struct {Bytes payload;} zmk_custom_CallRequest;
typedef struct {size_t size;uint8_t bytes[16];} Nonce;
typedef struct {Nonce nonce;char expected_build_id[65];} ryong_update_Prepare;
typedef struct {Nonce nonce;} ryong_update_Confirm;
typedef struct {char model[40];char build_id[65];uint32_t version;bool bootloader_allowed;} Identity;
typedef struct {bool ok;uint32_t error;} Status;
typedef struct {int which_request_type;union {ryong_update_Prepare prepare;ryong_update_Confirm confirm;} request_type;} ryong_update_Request;
typedef struct {int which_response_type;union {Identity identity;Status status;} response_type;} ryong_update_Response;
#define ryong_update_Request_init_zero {0}
#define ryong_update_Request_fields NULL
#define ryong_update_Request_identity_tag 1
#define ryong_update_Request_prepare_tag 2
#define ryong_update_Request_confirm_tag 3
#define ryong_update_Response_identity_tag 1
#define ryong_update_Response_status_tag 2
typedef struct {int unused;} pb_istream_t;
static ryong_update_Request incoming;
static bool decode_ok=true;
static pb_istream_t pb_istream_from_buffer(const void *p,size_t n){(void)p;(void)n;return (pb_istream_t){0};}
static bool pb_decode(pb_istream_t *s,const void *fields,ryong_update_Request *r){(void)s;(void)fields;*r=incoming;return decode_ok;}
#define ZMK_RPC_CUSTOM_SUBSYSTEM(n,m,handler) static const void *n##_meta __attribute__((unused))=m
#define ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(n,type) static type n##_response
#define ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(n,e) ((void)(e),&n##_response)
'''
HARNESS=r'''
#include <assert.h>
#include <string.h>
#include "adapter.c"
static void call(void){zmk_custom_CallRequest raw={0};pb_callback_t cb={0};assert(handle(&raw,&cb));}
int main(void){
 assert(meta.security==1&&identity_meta.security==0);
 zmk_custom_CallRequest raw={0};pb_callback_t cb={0};
 incoming.which_request_type=1;assert(identity_handle(&raw,&cb));assert(ryong__firmware_identity_response.which_response_type==1);
 assert(!strcmp(ryong__firmware_identity_response.response_type.identity.model,"test-model"));
 incoming.which_request_type=2;identity_handle(&raw,&cb);assert(!ryong__firmware_identity_response.response_type.status.ok&&scheduled==0);
 incoming.request_type.prepare.nonce.size=16;memset(incoming.request_type.prepare.nonce.bytes,7,16);strcpy(incoming.request_type.prepare.expected_build_id,"test-build");
 call();
#if CONFIG_RYONG_UPDATE_BOOTLOADER_ALLOWED
 assert(ryong__firmware_update_response.response_type.status.ok);
 incoming.which_request_type=3;incoming.request_type.confirm.nonce.size=16;memset(incoming.request_type.confirm.nonce.bytes,6,16);call();assert(scheduled==0);
 incoming.which_request_type=2;incoming.request_type.prepare.nonce.size=16;memset(incoming.request_type.prepare.nonce.bytes,7,16);strcpy(incoming.request_type.prepare.expected_build_id,"test-build");call();
 incoming.which_request_type=3;incoming.request_type.confirm.nonce.size=16;memset(incoming.request_type.confirm.nonce.bytes,7,16);now=30001;call();assert(scheduled==0);
 now=40000;incoming.which_request_type=2;strcpy(incoming.request_type.prepare.expected_build_id,"test-build");call();
 incoming.which_request_type=3;memset(incoming.request_type.confirm.nonce.bytes,7,16);call();assert(scheduled==1);call();assert(scheduled==1);
 usb=false;incoming.which_request_type=2;strcpy(incoming.request_type.prepare.expected_build_id,"test-build");call();assert(!ryong__firmware_update_response.response_type.status.ok);
#else
 assert(!ryong__firmware_update_response.response_type.status.ok);assert(scheduled==0);
#endif
}
'''
class UpdateBridge(unittest.TestCase):
 def test_actual_rpc_guard(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'shim.h').write_text(HEADER)
   for name in ['pb_decode.h','zephyr/kernel.h','zephyr/device.h','zephyr/logging/log.h','zmk/behavior.h','zmk/endpoints.h','zmk/usb.h','zmk/studio/custom.h','ryong/update.pb.h']:
    h=p/name;h.parent.mkdir(parents=True,exist_ok=True);h.write_text('#include "shim.h"\n')
   (p/'adapter.c').write_bytes((ROOT/'modules/ryong-update/src/update_rpc.c').read_bytes());(p/'test.c').write_text(HARNESS)
   for allowed in [0,1]:
    result=subprocess.run([os.environ.get('CC','cc'),'-std=c11','-Wall','-Wextra','-Werror',f'-DCONFIG_RYONG_UPDATE_BOOTLOADER_ALLOWED={allowed}','-I'+str(p),str(p/'test.c'),'-o',str(p/'test')],capture_output=True,text=True)
    self.assertEqual(result.returncode,0,result.stderr)
    subprocess.run([str(p/'test')],check=True,capture_output=True)
if __name__=='__main__':unittest.main()
