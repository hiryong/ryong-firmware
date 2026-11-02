/* SPDX-License-Identifier: MIT */
#include <errno.h>
#include <string.h>
#include <pb_decode.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zmk/studio/custom.h>
#include <ryong/settings.pb.h>
#include <ryong/settings_runtime.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define RYONG_SETTINGS_PROTOCOL 1

/* Secured: reading and changing settings both require Studio unlock. */
static struct zmk_rpc_custom_subsystem_meta meta = {.security = ZMK_STUDIO_RPC_HANDLER_SECURED};
static bool handle(const zmk_custom_CallRequest *request, pb_callback_t *response);
ZMK_RPC_CUSTOM_SUBSYSTEM(ryong__settings, &meta, handle);
ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(ryong__settings, ryong_settings_Response);

static void to_pb(const struct ry_light *l, ryong_settings_Light *p) {
    p->use = l->use;
    p->on_at_start = l->on_at_start;
    p->brightness = l->brightness;
    p->usb_only = l->usb_only;
}
static int from_pb(const ryong_settings_Light *p, bool has, struct ry_light *l) {
    if (!has || p->brightness > 100) return -EINVAL;
    l->use = p->use;
    l->on_at_start = p->on_at_start;
    l->brightness = (uint8_t)p->brightness;
    l->usb_only = p->usb_only;
    return 0;
}

static void fill_state(ryong_settings_Response *response) {
    struct ry_settings s;
    struct ry_rs_live live;
    ry_rs_get(&s);
    ry_rs_live(&live);
    response->which_response_type = ryong_settings_Response_state_tag;
    ryong_settings_State *st = &response->response_type.state;
    memset(st, 0, sizeof(*st));
    st->has_settings = true;
    st->settings.sleep_enabled = s.sleep_enabled;
    st->settings.sleep_minutes = s.sleep_minutes;
    st->settings.has_backlight = true;
    to_pb(&s.backlight, &st->settings.backlight);
    st->settings.has_underglow = true;
    to_pb(&s.underglow, &st->settings.underglow);
    st->has_caps = true;
    st->caps.backlight = live.has_backlight;
    st->caps.underglow = live.has_underglow;
    st->caps.sleep_max_minutes = IS_ENABLED(CONFIG_ZMK_SLEEP) ? RY_RS_SLEEP_MAX_MIN : 0;
    st->backlight_on = live.backlight_on;
    st->underglow_on = live.underglow_on;
    st->usb_powered = live.usb_powered;
    st->protocol_version = RYONG_SETTINGS_PROTOCOL;
}

static void status(ryong_settings_Response *response, int rc) {
    response->which_response_type = ryong_settings_Response_status_tag;
    response->response_type.status.ok = false;
    response->response_type.status.error = (uint32_t)(rc < 0 ? -rc : (rc ? rc : EIO));
}

static bool handle(const zmk_custom_CallRequest *raw, pb_callback_t *encoded) {
    ryong_settings_Response *response = ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(ryong__settings, encoded);
    ryong_settings_Request request = ryong_settings_Request_init_zero;
    pb_istream_t stream = pb_istream_from_buffer(raw->payload.bytes, raw->payload.size);
    if (!pb_decode(&stream, ryong_settings_Request_fields, &request)) {
        status(response, -EINVAL);
        return true;
    }
    int rc = 0;
    switch (request.which_request_type) {
    case ryong_settings_Request_get_state_tag:
        break;
    case ryong_settings_Request_set_tag: {
        const ryong_settings_Settings *p = &request.request_type.set;
        struct ry_settings s;
        memset(&s, 0, sizeof(s));
        s.sleep_enabled = p->sleep_enabled;
        s.sleep_minutes = p->sleep_minutes > 0xffff ? 0 : (uint16_t)p->sleep_minutes;
        rc = from_pb(&p->backlight, p->has_backlight, &s.backlight);
        if (!rc) rc = from_pb(&p->underglow, p->has_underglow, &s.underglow);
        if (!rc) rc = ry_rs_set(&s);
        break;
    }
    case ryong_settings_Request_power_tag:
        rc = ry_rs_power(request.request_type.power.which, request.request_type.power.on);
        break;
    default:
        rc = -ENOTSUP;
    }
    if (rc) status(response, rc);
    else fill_state(response);
    return true;
}
