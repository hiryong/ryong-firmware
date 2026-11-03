/*
 * Copyright (c) 2026 cormoran
 * Copyright (c) 2026 Ryong
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * BLE host OS detection (Ryong rewrite of cormoran's read-pattern detector).
 *
 * What decides, strongest first:
 *   1. the user's manual choice (override, os_detection_settings.c / core)
 *   2. the host's own answer: its Device Information / Apple services (os_detection_ble_probe.c)
 *   3. which of our characteristics the host read while it PAIRED
 * A slot's host only changes with a new pairing, and only a new pairing makes a host do its full
 * discovery; on reconnects hosts read from their cache (a Mac read nothing, or the "Android"
 * pattern, and used to flip the slot to the Windows layout - bench 2026-11-03). So a read pattern
 * only decides on a fresh pairing (or for a slot that has no result yet); reconnects keep it.
 *
 * Counters live per CONNECTION, not per slot: during a fresh pairing the host's address is not on
 * any slot yet, so per-slot counters were never reset and the previous host's reads leaked into
 * the new host's result. The slot is resolved when the read burst has settled.
 *
 * All decisions run on the system work queue (settings writes, zmk_os_changed), never in the
 * Bluetooth receive thread.
 */

#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>

#include <zmk/ble.h>

#include "os_detection_internal.h"

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

/* Read-pattern classifier. Real captures behind it (cormoran 2026-07-05, Ryong 2026-11-03):
 *  - Windows (and desktop Linux) read GAP Appearance together with DIS PnP ID and the HID service.
 *  - macOS / iOS never read Appearance; a Mac read only the report map on one pairing and
 *    map + info + PnP on another.
 *  - Android reads map + info (+ PnP) without Appearance - the same as that Mac. The two cannot
 *    be told apart this way; Apple is the likelier host for this keyboard, so that pattern is
 *    Apple here (an Android user sets the layout once by hand). */
enum zmk_os zmk_os_classify_ble(const struct ble_fp_stats *s) {
    if (s->apple_probe == ZMK_OS_PROBE_IOS || s->ancs_or_ams_present) {
        return ZMK_OS_IOS;
    }
    if (s->apple_probe == ZMK_OS_PROBE_MAC) {
        return ZMK_OS_MACOS;
    }
    if (s->report_map_reads == 0 && s->hids_info_reads == 0 && s->pnp_id_reads == 0 && s->appearance_reads == 0) {
        return s->apple_probe == ZMK_OS_PROBE_NOT_APPLE ? ZMK_OS_WINDOWS : ZMK_OS_UNKNOWN;
    }
    if (s->apple_probe == ZMK_OS_PROBE_NOT_APPLE) {
        return ZMK_OS_WINDOWS;
    }
    if (s->appearance_reads > 0 && s->pnp_id_reads > 0 && (s->report_map_reads > 0 || s->hids_info_reads > 0)) {
        return ZMK_OS_WINDOWS;
    }
    return ZMK_OS_MACOS;
}

struct session {
    struct bt_conn *conn; /* identity only, not referenced; NULL = free */
    struct ble_fp_stats stats;
    struct k_work_delayable settle;
    bool settled;
    bool fresh;     /* this connection paired (new bond) */
    int8_t profile; /* resolved at settle, -1 before */
};

static struct session sessions[CONFIG_BT_MAX_CONN];

/* Diagnostics per slot, reported over Studio. */
static struct ble_fp_stats last_fp[ZMK_BLE_PROFILE_COUNT];
static enum zmk_os last_classified[ZMK_BLE_PROFILE_COUNT];
static bool last_kept[ZMK_BLE_PROFILE_COUNT];
static bool last_valid[ZMK_BLE_PROFILE_COUNT];

bool zmk_os_detection_ble_last_fingerprint(uint8_t profile_index, struct ble_fp_stats *out, enum zmk_os *classified,
                                           bool *kept_cached) {
    if (profile_index >= ZMK_BLE_PROFILE_COUNT || !last_valid[profile_index]) {
        return false;
    }
    *out = last_fp[profile_index];
    *classified = last_classified[profile_index];
    *kept_cached = last_kept[profile_index];
    return true;
}

static struct session *session_for(struct bt_conn *conn) {
    uint8_t i = bt_conn_index(conn);
    if (i >= ARRAY_SIZE(sessions) || sessions[i].conn != conn) {
        return NULL;
    }
    return &sessions[i];
}

static enum zmk_os stored_result(uint8_t profile) {
#if IS_ENABLED(CONFIG_ZMK_CUSTOM_SETTINGS)
    return zmk_os_detection_settings_get_detected_cache(profile);
#else
    return zmk_os_detection_ble_profile_detected(profile);
#endif
}

/* Decide (or keep) the slot's OS from what this connection has seen. System work queue only. */
static void decide(struct session *s) {
    if (s->profile < 0 || s->profile >= ZMK_BLE_PROFILE_COUNT) {
        return;
    }
    uint8_t p = s->profile;
#if IS_ENABLED(CONFIG_ZMK_OS_DETECTION_BLE_GATT_CLIENT_PROBE)
    s->stats.apple_probe = zmk_os_detection_probe_result(p);
#endif
    enum zmk_os detected = zmk_os_classify_ble(&s->stats);
    bool host_said = s->stats.apple_probe != ZMK_OS_PROBE_NONE || s->stats.ancs_or_ams_present;
    enum zmk_os stored = stored_result(p);
    bool apply = detected != ZMK_OS_UNKNOWN && (s->fresh || host_said || stored == ZMK_OS_UNKNOWN);

    last_fp[p] = s->stats;
    last_classified[p] = detected;
    last_kept[p] = !apply;
    last_valid[p] = true;
    LOG_INF("os detection: slot %d map=%u info=%u report=%u pnp=%u appearance=%u probe=%u ll_company=0x%04x "
            "fresh=%d -> %d (%s)",
            p, s->stats.report_map_reads, s->stats.hids_info_reads, s->stats.report_ref_reads,
            s->stats.pnp_id_reads, s->stats.appearance_reads, s->stats.apple_probe, s->stats.ll_company_id,
            s->fresh, detected, apply ? "applied" : "kept");
    if (apply) {
        zmk_os_detection_report_ble_detected(p, detected);
    }
}

static void settle_work_handler(struct k_work *work) {
    struct k_work_delayable *dwork = k_work_delayable_from_work(work);
    struct session *s = CONTAINER_OF(dwork, struct session, settle);
    if (!s->conn) {
        return;
    }
    int profile = zmk_ble_profile_index(bt_conn_get_dst(s->conn));
    if (profile < 0 && s->fresh) {
        profile = zmk_ble_active_profile_index(); /* a new pairing is always on the active slot */
    }
    if (profile < 0 || profile >= ZMK_BLE_PROFILE_COUNT) {
        return; /* not paired yet: keep counting; pairing_complete settles again */
    }
    s->settled = true;
    s->profile = profile;
    decide(s);
#if IS_ENABLED(CONFIG_ZMK_OS_DETECTION_BLE_GATT_CLIENT_PROBE)
    zmk_os_detection_probe_start(s->conn, profile, s->fresh);
#endif
}

/* Probe finished for a slot: decide again with the host's own answer (system work queue). */
void zmk_os_detection_ble_reclassify(uint8_t profile_index) {
    for (int i = 0; i < ARRAY_SIZE(sessions); i++) {
        if (sessions[i].conn && sessions[i].settled && sessions[i].profile == profile_index) {
            decide(&sessions[i]);
            return;
        }
    }
}

static void rearm(struct session *s) {
    if (!s->settled) {
        k_work_reschedule(&s->settle, K_MSEC(CONFIG_ZMK_OS_DETECTION_BLE_SETTLE_MS));
    }
}

static bool read_authorize(struct bt_conn *conn, const struct bt_gatt_attr *attr) {
    struct session *s = session_for(conn);
    if (!s || s->settled) {
        return true; /* observation only; never block a read */
    }
    struct ble_fp_stats *st = &s->stats;
    if (bt_uuid_cmp(attr->uuid, BT_UUID_HIDS_REPORT_MAP) == 0) {
        st->report_map_reads++;
    } else if (bt_uuid_cmp(attr->uuid, BT_UUID_HIDS_INFO) == 0) {
        st->hids_info_reads++;
    } else if (bt_uuid_cmp(attr->uuid, BT_UUID_HIDS_REPORT) == 0) {
        st->report_ref_reads++;
    } else if (bt_uuid_cmp(attr->uuid, BT_UUID_DIS_PNP_ID) == 0) {
        st->pnp_id_reads++;
    } else if (bt_uuid_cmp(attr->uuid, BT_UUID_GAP_APPEARANCE) == 0) {
        st->appearance_reads++;
    } else {
        return true; /* e.g. Battery Level polls: not a signal, don't delay settling */
    }
    rearm(s);
    return true;
}

static struct bt_gatt_authorization_cb authorization_cb = {
    .read_authorize = read_authorize,
};

static void att_mtu_updated(struct bt_conn *conn, uint16_t tx, uint16_t rx) {
    ARG_UNUSED(tx);
    struct session *s = session_for(conn);
    if (s) {
        s->stats.att_mtu = rx;
    }
}

static struct bt_gatt_cb gatt_cb = {
    .att_mtu_updated = att_mtu_updated,
};

static void connected(struct bt_conn *conn, uint8_t err) {
    struct bt_conn_info info;
    if (err || bt_conn_get_info(conn, &info) || info.role != BT_CONN_ROLE_PERIPHERAL) {
        return;
    }
    uint8_t i = bt_conn_index(conn);
    if (i >= ARRAY_SIZE(sessions)) {
        return;
    }
    struct session *s = &sessions[i];
    k_work_cancel_delayable(&s->settle);
    memset(&s->stats, 0, sizeof(s->stats));
    s->conn = conn;
    s->settled = false;
    s->fresh = false;
    s->profile = -1;
    s->stats.initial_conn_interval = info.le.interval;
    /* A host that reads nothing still gets a settle (keeps the stored result, starts the probe). */
    k_work_reschedule(&s->settle, K_MSEC(CONFIG_ZMK_OS_DETECTION_BLE_SETTLE_MS * 2));

#if IS_ENABLED(CONFIG_ZMK_CUSTOM_SETTINGS)
    /* Known host: adopt its stored result at once. */
    int profile = zmk_ble_profile_index(bt_conn_get_dst(conn));
    if (profile >= 0 && profile < ZMK_BLE_PROFILE_COUNT) {
        enum zmk_os cached = zmk_os_detection_settings_get_detected_cache(profile);
        if (cached != ZMK_OS_UNKNOWN) {
            zmk_os_detection_report_ble_detected(profile, cached);
        }
    }
#endif
}

static void disconnected(struct bt_conn *conn, uint8_t reason) {
    ARG_UNUSED(reason);
    struct session *s = session_for(conn);
    if (s) {
        k_work_cancel_delayable(&s->settle);
        s->conn = NULL;
    }
}

static void param_updated(struct bt_conn *conn, uint16_t interval, uint16_t latency, uint16_t timeout) {
    ARG_UNUSED(latency);
    ARG_UNUSED(timeout);
    struct session *s = session_for(conn);
    if (s && s->stats.initial_conn_interval == 0) {
        s->stats.initial_conn_interval = interval;
    }
}

#if IS_ENABLED(CONFIG_BT_REMOTE_INFO)
static void remote_info_available(struct bt_conn *conn, struct bt_conn_remote_info *remote_info) {
    struct session *s = session_for(conn);
    if (s) {
        s->stats.ll_company_id = remote_info->manufacturer;
        s->stats.ll_version = remote_info->version;
    }
}
#endif

static struct bt_conn_cb conn_cb = {
    .connected = connected,
    .disconnected = disconnected,
    .le_param_updated = param_updated,
#if IS_ENABLED(CONFIG_BT_REMOTE_INFO)
    .remote_info_available = remote_info_available,
#endif
};

/* A brand-new bond: this connection's reads decide the slot. Bluetooth thread: only flag and
 * (re)schedule the decision. */
static void pairing_complete(struct bt_conn *conn, bool bonded) {
    ARG_UNUSED(bonded);
    struct session *s = session_for(conn);
    if (!s) {
        return;
    }
    s->fresh = true;
    s->settled = false;
    k_work_reschedule(&s->settle, K_MSEC(CONFIG_ZMK_OS_DETECTION_BLE_SETTLE_MS));
}

static struct bt_conn_auth_info_cb auth_info_cb = {
    .pairing_complete = pairing_complete,
};

static int os_detection_ble_init(void) {
    for (int i = 0; i < ARRAY_SIZE(sessions); i++) {
        sessions[i].profile = -1;
        k_work_init_delayable(&sessions[i].settle, settle_work_handler);
    }
    bt_gatt_authorization_cb_register(&authorization_cb);
    bt_gatt_cb_register(&gatt_cb);
    bt_conn_cb_register(&conn_cb);
    bt_conn_auth_info_cb_register(&auth_info_cb);
    return 0;
}

SYS_INIT(os_detection_ble_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
