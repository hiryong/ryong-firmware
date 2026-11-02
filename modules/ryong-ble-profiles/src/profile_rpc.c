/* SPDX-License-Identifier: MIT */
#include <errno.h>
#include <string.h>
#include <pb_decode.h>
#include <zephyr/kernel.h>
#include <zmk/studio/custom.h>
#include <ryong/ble_profiles.pb.h>
#include <ryong/ble_profile_store.h>

#define RYONG_BLE_PROFILES_PROTOCOL 1
BUILD_ASSERT(sizeof(((ryong_ble_profiles_Profile *)0)->name) == RY_BT_NAME_MAX + 1);
BUILD_ASSERT(sizeof(((ryong_ble_profiles_Rename *)0)->name) == RY_BT_NAME_MAX + 1);

/* Secured: every call, including listing names, requires Studio unlock. */
static struct zmk_rpc_custom_subsystem_meta meta = {.security = ZMK_STUDIO_RPC_HANDLER_SECURED};
static bool handle(const zmk_custom_CallRequest *request, pb_callback_t *response);
ZMK_RPC_CUSTOM_SUBSYSTEM(ryong__ble_profiles, &meta, handle);
ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(ryong__ble_profiles, ryong_ble_profiles_Response);

static void status(ryong_ble_profiles_Response *response, int rc) {
    response->which_response_type = ryong_ble_profiles_Response_status_tag;
    response->response_type.status.ok = false;
    response->response_type.status.error = (uint32_t)(rc < 0 ? -rc : (rc ? rc : EIO));
}

static void fill_state(ryong_ble_profiles_Response *response) {
    ryong_ble_profiles_State *state = &response->response_type.state;
    response->which_response_type = ryong_ble_profiles_Response_state_tag;
    memset(state, 0, sizeof(*state));
    int count = ryong_bt_profiles_count();
    for (int i = 0; i < count && i < (int)ARRAY_SIZE(state->profiles); i++) {
        struct ryong_bt_profile_info info;
        ryong_ble_profiles_Profile *p = &state->profiles[state->profiles_count++];
        p->index = (uint32_t)i;
        if (ryong_bt_profile_info((uint8_t)i, &info)) continue;
        p->bonded = info.bonded;
        p->connected = info.connected;
        p->token = info.token;
        strncpy(p->name, info.name, sizeof(p->name) - 1);
    }
    state->active_index = (uint32_t)ryong_bt_profiles_active();
    state->name_max_bytes = RY_BT_NAME_MAX;
    state->protocol_version = RYONG_BLE_PROFILES_PROTOCOL;
}

static bool handle(const zmk_custom_CallRequest *raw, pb_callback_t *encoded) {
    ryong_ble_profiles_Response *response =
        ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(ryong__ble_profiles, encoded);
    ryong_ble_profiles_Request request = ryong_ble_profiles_Request_init_zero;
    pb_istream_t stream = pb_istream_from_buffer(raw->payload.bytes, raw->payload.size);
    if (!pb_decode(&stream, ryong_ble_profiles_Request_fields, &request)) {
        status(response, -EINVAL);
        return true;
    }
    int rc = 0;
    switch (request.which_request_type) {
    case ryong_ble_profiles_Request_get_state_tag:
        /* Cleanup of names orphaned by on-keyboard BT_CLR/re-pairing. A write
         * failure is harmless: orphaned names are never displayed. */
        (void)ryong_bt_profiles_purge_stale();
        break;
    case ryong_ble_profiles_Request_select_tag: {
        uint32_t index = request.request_type.select.index;
        rc = index < (uint32_t)ryong_bt_profiles_count() ? ryong_bt_profile_select((uint8_t)index) : -EINVAL;
        break;
    }
    case ryong_ble_profiles_Request_rename_tag: {
        const ryong_ble_profiles_Rename *r = &request.request_type.rename;
        size_t len = strnlen(r->name, sizeof(r->name));
        rc = r->index < (uint32_t)ryong_bt_profiles_count() && len < sizeof(r->name)
                 ? ryong_bt_profile_rename((uint8_t)r->index, r->token, r->name, len)
                 : -EINVAL;
        break;
    }
    case ryong_ble_profiles_Request_clear_tag: {
        const ryong_ble_profiles_Clear *c = &request.request_type.clear;
        rc = c->index < (uint32_t)ryong_bt_profiles_count()
                 ? ryong_bt_profile_clear((uint8_t)c->index, c->token)
                 : -EINVAL;
        break;
    }
    default:
        rc = -ENOTSUP;
    }
    if (rc) status(response, rc);
    else fill_state(response);
    return true;
}
