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
 * Service as a GATT server: Manufacturer Name "Apple Inc." and a Model Number such as
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

static uint8_t result[ZMK_BLE_PROFILE_COUNT];

struct probe {
    struct k_work_delayable work;
    struct bt_conn *conn; /* referenced while scheduled/running */
    uint8_t profile;
    uint8_t step; /* 0 = manufacturer, 1 = model */
    struct bt_gatt_read_params params;
    char manu[TEXT_MAX];
    char model[TEXT_MAX];
    size_t manu_len, model_len;
};

static struct probe probe;
static atomic_t busy;

uint8_t zmk_os_detection_probe_result(uint8_t profile_index) {
    return profile_index < ZMK_BLE_PROFILE_COUNT ? result[profile_index] : ZMK_OS_PROBE_NONE;
}

static bool contains(const char *s, size_t n, const char *needle) {
    size_t k = strlen(needle);
    for (size_t i = 0; i + k <= n; i++) {
        if (strncmp(s + i, needle, k) == 0) {
            return true;
        }
    }
    return false;
}

static void finish(void) {
    uint8_t r = ZMK_OS_PROBE_NONE;
    if (probe.manu_len) {
        if (contains(probe.manu, probe.manu_len, "Apple")) {
            r = (contains(probe.model, probe.model_len, "iPhone") || contains(probe.model, probe.model_len, "iPad") ||
                 contains(probe.model, probe.model_len, "iPod"))
                    ? ZMK_OS_PROBE_IOS
                    : ZMK_OS_PROBE_MAC;
        } else {
            r = ZMK_OS_PROBE_NOT_APPLE;
        }
    } else if (contains(probe.model, probe.model_len, "Mac") || contains(probe.model, probe.model_len, "iPhone") ||
               contains(probe.model, probe.model_len, "iPad")) {
        r = contains(probe.model, probe.model_len, "Mac") ? ZMK_OS_PROBE_MAC : ZMK_OS_PROBE_IOS;
    }
    LOG_INF("os detection: host says manufacturer=\"%.*s\" model=\"%.*s\" -> probe %d", (int)probe.manu_len,
            probe.manu, (int)probe.model_len, probe.model, r);
    result[probe.profile] = r;
    uint8_t profile = probe.profile;
    bt_conn_unref(probe.conn);
    probe.conn = NULL;
    atomic_clear(&busy);
    zmk_os_detection_ble_reclassify(profile);
}

static void read_next(void);

static uint8_t read_cb(struct bt_conn *conn, uint8_t err, struct bt_gatt_read_params *params, const void *data,
                       uint16_t length) {
    ARG_UNUSED(conn);
    ARG_UNUSED(params);
    if (!err && data && length) {
        char *dst = probe.step == 0 ? probe.manu : probe.model;
        size_t *len = probe.step == 0 ? &probe.manu_len : &probe.model_len;
        size_t n = MIN(length, TEXT_MAX - *len);
        memcpy(dst + *len, data, n);
        *len += n;
        return BT_GATT_ITER_STOP; /* first match is enough */
    }
    /* err (e.g. attribute not found) or end of data: move on */
    probe.step++;
    if (probe.step < 2) {
        read_next();
    } else {
        finish();
    }
    return BT_GATT_ITER_STOP;
}

static void read_next(void) {
    memset(&probe.params, 0, sizeof(probe.params));
    probe.params.func = read_cb;
    probe.params.handle_count = 0; /* read by UUID */
    probe.params.by_uuid.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
    probe.params.by_uuid.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
    probe.params.by_uuid.uuid = probe.step == 0 ? BT_UUID_DIS_MANUFACTURER_NAME : BT_UUID_DIS_MODEL_NUMBER;
    int err = bt_gatt_read(probe.conn, &probe.params);
    if (err) {
        LOG_DBG("os detection: probe read failed to start (%d)", err);
        probe.step++;
        if (probe.step < 2) {
            read_next();
        } else {
            finish();
        }
    }
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
    probe.step = 0;
    probe.manu_len = probe.model_len = 0;
    read_next();
}

static void security_changed(struct bt_conn *conn, bt_security_t level, enum bt_security_err err) {
    if (err || level < BT_SECURITY_L2) {
        return;
    }
    int profile = zmk_ble_profile_index(bt_conn_get_dst(conn));
    if (profile < 0 || profile >= ZMK_BLE_PROFILE_COUNT) {
        return;
    }
    if (!atomic_cas(&busy, 0, 1)) {
        return; /* one probe at a time; another connection is being asked */
    }
    probe.conn = bt_conn_ref(conn);
    probe.profile = (uint8_t)profile;
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
    if (probe.conn == conn && k_work_cancel_delayable(&probe.work) == 0) {
        /* cancelled before it ran: drop the reference; a running read finishes through read_cb */
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
