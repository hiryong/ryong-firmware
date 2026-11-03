/*
 * Copyright (c) 2026 Ryong
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * Ryong: ask the host who it is (BLE GATT client probe).
 *
 * The read pattern of a host's HID discovery cannot tell a Mac from a Windows PC reliably (modern
 * macOS reads the same characteristics). Apple devices, however, publish a Device Information
 * Service (Manufacturer Name "Apple Inc.", Model Number such as
 * "MacBookPro18,3" or "iPhone14,2". Once the link is encrypted we read those two strings from the
 * host. Apple → macOS or iOS, decisively. Another maker's name → not Apple. Nothing readable → no
 * opinion, the fingerprint decides as before. Read only, once per connection, a few hundred ms.
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

#define TEXT_MAX 32
#define START_DELAY K_MSEC(1500) /* let the host finish its own discovery first */

/* Apple "Continuity" GATT service, published by Macs, iPhones and iPads. */
static struct bt_uuid_128 continuity_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xd0611e78, 0xbbb4, 0x4591, 0xa5f8, 0x487910ae4366));

static uint8_t result[ZMK_BLE_PROFILE_COUNT];
static struct zmk_os_probe_info info_by_profile[ZMK_BLE_PROFILE_COUNT];

bool zmk_os_detection_probe_info(uint8_t profile_index, struct zmk_os_probe_info *out) {
    if (profile_index >= ZMK_BLE_PROFILE_COUNT) {
        return false;
    }
    *out = info_by_profile[profile_index];
    return true;
}

enum { STEP_MANU, STEP_MODEL, STEP_NAME, STEP_CONTINUITY, STEP_DONE };

struct probe {
    struct k_work_delayable work;
    struct bt_conn *conn; /* referenced while scheduled/running */
    uint8_t step;
    struct bt_gatt_read_params params;
    struct bt_gatt_discover_params disc;
    char text[3][TEXT_MAX]; /* manufacturer, model, device name */
    size_t len[3];
    bool continuity;
};

static struct probe probe;
static atomic_t busy;
static bool running; /* reads in flight: their callbacks end the probe */

uint8_t zmk_os_detection_probe_result(uint8_t profile_index) {
    return profile_index < ZMK_BLE_PROFILE_COUNT ? result[profile_index] : ZMK_OS_PROBE_NONE;
}

static bool has(int i, const char *needle) {
    size_t k = strlen(needle);
    for (size_t j = 0; j + k <= probe.len[i]; j++) {
        if (strncmp(probe.text[i] + j, needle, k) == 0) {
            return true;
        }
    }
    return false;
}
static bool any(const char *needle) { return has(0, needle) || has(1, needle) || has(2, needle); }

static void finish(void) {
    bool ios = any("iPhone") || any("iPad") || any("iPod");
    bool apple = probe.continuity || has(0, "Apple") || ios || any("Mac") || has(1, "iMac");
    uint8_t r = ZMK_OS_PROBE_NONE;
    if (apple) {
        r = ios ? ZMK_OS_PROBE_IOS : ZMK_OS_PROBE_MAC;
    } else if (probe.len[0]) {
        r = ZMK_OS_PROBE_NOT_APPLE; /* named another maker */
    }
    /* The slot is resolved now, not at connect: a brand-new pairing gets its slot address late. */
    int profile = zmk_ble_profile_index(bt_conn_get_dst(probe.conn));
    if (profile < 0) {
        profile = zmk_ble_active_profile_index();
    }
    LOG_INF("os detection: host manufacturer=\"%.*s\" model=\"%.*s\" name=\"%.*s\" continuity=%d -> probe %d (slot %d)",
            (int)probe.len[0], probe.text[0], (int)probe.len[1], probe.text[1], (int)probe.len[2], probe.text[2],
            probe.continuity, r, profile);
    bt_conn_unref(probe.conn);
    probe.conn = NULL;
    running = false;
    atomic_clear(&busy);
    if (profile >= 0 && profile < ZMK_BLE_PROFILE_COUNT) {
        struct zmk_os_probe_info *dst = &info_by_profile[profile];
        memset(dst, 0, sizeof(*dst));
        memcpy(dst->manufacturer, probe.text[0], MIN(probe.len[0], sizeof(dst->manufacturer) - 1));
        memcpy(dst->model, probe.text[1], MIN(probe.len[1], sizeof(dst->model) - 1));
        memcpy(dst->name, probe.text[2], MIN(probe.len[2], sizeof(dst->name) - 1));
        dst->continuity = probe.continuity;
        result[profile] = r;
        zmk_os_detection_ble_reclassify(profile);
    }
}

static void next_step(void);

static uint8_t read_cb(struct bt_conn *conn, uint8_t err, struct bt_gatt_read_params *params, const void *data,
                       uint16_t length) {
    ARG_UNUSED(conn);
    ARG_UNUSED(params);
    if (!err && data && length && probe.step < STEP_CONTINUITY) {
        int i = probe.step;
        size_t n = MIN(length, TEXT_MAX - probe.len[i]);
        memcpy(probe.text[i] + probe.len[i], data, n);
        probe.len[i] += n;
        return BT_GATT_ITER_STOP; /* first match is enough */
    }
    probe.step++;
    next_step();
    return BT_GATT_ITER_STOP;
}

static uint8_t discover_cb(struct bt_conn *conn, const struct bt_gatt_attr *attr, struct bt_gatt_discover_params *params) {
    ARG_UNUSED(conn);
    ARG_UNUSED(params);
    if (attr) {
        probe.continuity = true;
        return BT_GATT_ITER_STOP;
    }
    probe.step = STEP_DONE; /* discovery finished (found or not) */
    next_step();
    return BT_GATT_ITER_STOP;
}

static void next_step(void) {
    while (probe.step < STEP_DONE) {
        int err;
        if (probe.step == STEP_CONTINUITY) {
            memset(&probe.disc, 0, sizeof(probe.disc));
            probe.disc.uuid = &continuity_uuid.uuid;
            probe.disc.func = discover_cb;
            probe.disc.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
            probe.disc.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
            probe.disc.type = BT_GATT_DISCOVER_PRIMARY;
            err = bt_gatt_discover(probe.conn, &probe.disc);
        } else {
            memset(&probe.params, 0, sizeof(probe.params));
            probe.params.func = read_cb;
            probe.params.handle_count = 0; /* read by UUID */
            probe.params.by_uuid.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
            probe.params.by_uuid.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
            probe.params.by_uuid.uuid = probe.step == STEP_MANU    ? BT_UUID_DIS_MANUFACTURER_NAME
                                        : probe.step == STEP_MODEL ? BT_UUID_DIS_MODEL_NUMBER
                                                                   : BT_UUID_GAP_DEVICE_NAME;
            err = bt_gatt_read(probe.conn, &probe.params);
        }
        if (!err) {
            return; /* continues in the callback */
        }
        LOG_DBG("os detection: probe step %d failed to start (%d)", probe.step, err);
        probe.step++;
    }
    finish();
}

static void probe_work_cb(struct k_work *work) {
    ARG_UNUSED(work);
    struct bt_conn_info info;
    if (!probe.conn || bt_conn_get_info(probe.conn, &info) || info.state != BT_CONN_STATE_CONNECTED) {
        if (probe.conn) {
            bt_conn_unref(probe.conn);
            probe.conn = NULL;
        }
        atomic_clear(&busy);
        return;
    }
    probe.step = STEP_MANU;
    memset(probe.len, 0, sizeof(probe.len));
    probe.continuity = false;
    running = true;
    next_step();
}

static void security_changed(struct bt_conn *conn, bt_security_t level, enum bt_security_err err) {
    struct bt_conn_info info;
    if (err || level < BT_SECURITY_L2 || bt_conn_get_info(conn, &info) || info.role != BT_CONN_ROLE_PERIPHERAL) {
        return;
    }
    if (!atomic_cas(&busy, 0, 1)) {
        return; /* one probe at a time; another connection is being asked */
    }
    probe.conn = bt_conn_ref(conn);
    k_work_reschedule(&probe.work, START_DELAY);
}

static void connected(struct bt_conn *conn, uint8_t err) {
    if (err) {
        return;
    }
    int profile = zmk_ble_profile_index(bt_conn_get_dst(conn));
    if (profile >= 0 && profile < ZMK_BLE_PROFILE_COUNT) {
        result[profile] = ZMK_OS_PROBE_NONE; /* ask again: the slot may now belong to another host */
    }
}

static void disconnected(struct bt_conn *conn, uint8_t reason) {
    ARG_UNUSED(reason);
    if (probe.conn == conn && !running) {
        /* not started yet: drop it; a running probe finishes through its callbacks (they get an error) */
        k_work_cancel_delayable(&probe.work);
        bt_conn_unref(probe.conn);
        probe.conn = NULL;
        atomic_clear(&busy);
    }
}

static struct bt_conn_cb probe_conn_cb = {
    .connected = connected,
    .security_changed = security_changed,
    .disconnected = disconnected,
};

static int probe_init(void) {
    k_work_init_delayable(&probe.work, probe_work_cb);
    bt_conn_cb_register(&probe_conn_cb);
    return 0;
}

SYS_INIT(probe_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
