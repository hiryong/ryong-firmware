// Copyright (c) 2026 qtrnmr
// SPDX-License-Identifier: MIT
//
// ZMK Runtime Hold-Tap - Custom Studio RPC handler. Exposes count / get / set
// / reset of per-slot hold-tap timing over the cormoran custom RPC subsystem
// `zmk__holdtap`. All results are returned in the response (no notifications).

#include <errno.h>

#include <pb_decode.h>
#include <pb_encode.h>
#include <zephyr/logging/log.h>

#include <zmk/behavior.h>
#include <zmk/runtime_holdtap.h>
#include <zmk/holdtap/holdtap.pb.h>
#include <zmk/studio/custom.h>
#include <zmk/studio/rpc.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define SLOTS CONFIG_ZMK_RUNTIME_HOLDTAP_SLOTS

static struct zmk_rpc_custom_subsystem_meta holdtap_rpc_meta = {
    .security = ZMK_STUDIO_RPC_HANDLER_SECURED,
};

static bool holdtap_rpc_handle_request(const zmk_custom_CallRequest *raw_request,
                                       pb_callback_t *encode_response);

ZMK_RPC_CUSTOM_SUBSYSTEM(zmk__holdtap, &holdtap_rpc_meta, holdtap_rpc_handle_request);
ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(zmk__holdtap, zmk_holdtap_Response);

static void handle_count(zmk_holdtap_Response *resp) {
    uint32_t count = 0;
    for (uint8_t s = 0; s < SLOTS; s++) {
        if (rt_holdtap_registered(s)) {
            count++;
        }
    }
    resp->response_type.count.count = count;
    resp->which_response_type = zmk_holdtap_Response_count_tag;
}

static void handle_get(const zmk_holdtap_SlotRequest *req, zmk_holdtap_Response *resp) {
    uint8_t slot = (uint8_t)req->slot;
    struct rt_holdtap_timing t;
    int rc = rt_holdtap_get(slot, &t);

    zmk_holdtap_HoldTapInfo *info = &resp->response_type.get;
    info->slot = slot;
    info->found = (rc == 0);
    if (rc == 0) {
        info->tapping_term_ms = t.tapping_term_ms;
        info->quick_tap_ms = t.quick_tap_ms;
        info->require_prior_idle_ms = t.require_prior_idle_ms;
        info->flavor = t.flavor;
        // Report which behavior owns this slot so the UI can match a key's
        // binding to its timing. UINT16_MAX is the "unknown name" sentinel of
        // zmk_behavior_get_local_id(); normalize it (and a missing name) to 0.
        const char *name = rt_holdtap_behavior_name(slot);
        zmk_behavior_local_id_t id = name ? zmk_behavior_get_local_id(name) : UINT16_MAX;
        info->behavior_id = (id == UINT16_MAX) ? 0 : id;
    }
    resp->which_response_type = zmk_holdtap_Response_get_tag;
}

static void handle_set(const zmk_holdtap_SetRequest *req, zmk_holdtap_Response *resp) {
    struct rt_holdtap_timing t = {
        .tapping_term_ms = req->tapping_term_ms,
        .quick_tap_ms = req->quick_tap_ms,
        .require_prior_idle_ms = req->require_prior_idle_ms,
        .flavor = (uint8_t)req->flavor,
    };
    int rc = rt_holdtap_set((uint8_t)req->slot, &t);
    resp->response_type.set.ok = (rc == 0);
    resp->response_type.set.error = (rc < 0) ? (uint32_t)(-rc) : 0;
    resp->which_response_type = zmk_holdtap_Response_set_tag;
}

static void handle_reset(const zmk_holdtap_SlotRequest *req, zmk_holdtap_Response *resp) {
    int rc = rt_holdtap_reset((uint8_t)req->slot);
    resp->response_type.reset.ok = (rc == 0);
    resp->response_type.reset.error = (rc < 0) ? (uint32_t)(-rc) : 0;
    resp->which_response_type = zmk_holdtap_Response_reset_tag;
}

static bool holdtap_rpc_handle_request(const zmk_custom_CallRequest *raw_request,
                                       pb_callback_t *encode_response) {
    zmk_holdtap_Response *resp =
        ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(zmk__holdtap, encode_response);

    zmk_holdtap_Request req = zmk_holdtap_Request_init_zero;
    pb_istream_t stream =
        pb_istream_from_buffer(raw_request->payload.bytes, raw_request->payload.size);
    if (!pb_decode(&stream, zmk_holdtap_Request_fields, &req)) {
        LOG_WRN("holdtap_rpc: decode failed: %s", PB_GET_ERROR(&stream));
        resp->which_response_type = zmk_holdtap_Response_set_tag;
        resp->response_type.set.ok = false;
        resp->response_type.set.error = UINT32_MAX;
        return true;
    }

    /* Validate before narrowing uint32 fields: 256 must never alias slot zero. */
    if ((req.which_request_type == zmk_holdtap_Request_get_tag && req.request_type.get.slot >= SLOTS) ||
        (req.which_request_type == zmk_holdtap_Request_reset_tag && req.request_type.reset.slot >= SLOTS) ||
        (req.which_request_type == zmk_holdtap_Request_set_tag &&
         (req.request_type.set.slot >= SLOTS || req.request_type.set.flavor > 3))) {
        resp->which_response_type = zmk_holdtap_Response_set_tag;
        resp->response_type.set.ok = false;
        resp->response_type.set.error = EINVAL;
        return true;
    }
    switch (req.which_request_type) {
    case zmk_holdtap_Request_count_tag:
        handle_count(resp);
        break;
    case zmk_holdtap_Request_get_tag:
        handle_get(&req.request_type.get, resp);
        break;
    case zmk_holdtap_Request_set_tag:
        handle_set(&req.request_type.set, resp);
        break;
    case zmk_holdtap_Request_reset_tag:
        handle_reset(&req.request_type.reset, resp);
        break;
    default:
        LOG_WRN("holdtap_rpc: unsupported request type %d", req.which_request_type);
        resp->which_response_type = zmk_holdtap_Response_set_tag;
        resp->response_type.set.ok = false;
        resp->response_type.set.error = UINT32_MAX;
        break;
    }

    return true;
}

// Clear all hold-tap slots when ZMK Studio issues reset_settings.
static int rt_holdtap_settings_reset(void) {
    rt_holdtap_clear_all();
    return 0;
}

ZMK_RPC_SUBSYSTEM_SETTINGS_RESET(rt_holdtap, rt_holdtap_settings_reset);

