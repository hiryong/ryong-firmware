/*
 * Copyright (c) 2026 Ryong
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * Ask the host who it is (BLE GATT client, read only).
 *
 * Apple hosts publish a Device Information Service (Manufacturer "Apple Inc.", Model Number such as
 * "MacBookPro18,3" / "iPhone14,2") and the Apple Continuity service. We read those few values once
 * the host has finished its own discovery of the keyboard: Apple model → macOS / iOS, another
 * manufacturer → not Apple, nothing readable → no opinion (the read pattern decides).
 *
 * Safety rules (an earlier version hung and leaked a connection reference):
 *  - every step ends in exactly one callback that moves to the next step; steps are started from a
 *    work item, never from inside a Bluetooth callback;
 *  - a 5 s watchdog always ends the probe and drops the connection reference;
 *  - security errors are just "no answer" (CONFIG_BT_ATT_RETRY_ON_SEC_ERR must be n, see Kconfig);
 *  - results are applied on the system work queue.
 * Once per slot per power-up, and on every new pairing.
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

BUILD_ASSERT(!IS_ENABLED(CONFIG_BT_ATT_RETRY_ON_SEC_ERR),
             "The host probe must not trigger security changes: set CONFIG_BT_ATT_RETRY_ON_SEC_ERR=n");

#define TEXT_MAX 32
#define WATCHDOG K_SECONDS(5)

static struct bt_uuid_128 continuity_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xd0611e78, 0xbbb4, 0x4591, 0xa5f8, 0x487910ae4366));
/* Apple Notification Center Service: iPhone / iPad only. */
static struct bt_uuid_128 ancs_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0x7905f431, 0xb5ce, 0x4e99, 0xa40f, 0x4b1e122d00d0));

static uint8_t result[ZMK_BLE_PROFILE_COUNT];
static bool asked[ZMK_BLE_PROFILE_COUNT];
static struct zmk_os_probe_info info_by_profile[ZMK_BLE_PROFILE_COUNT];

uint8_t zmk_os_detection_probe_result(uint8_t profile_index) {
    return profile_index < ZMK_BLE_PROFILE_COUNT ? result[profile_index] : ZMK_OS_PROBE_NONE;
}

bool zmk_os_detection_probe_info(uint8_t profile_index, struct zmk_os_probe_info *out) {
    if (profile_index >= ZMK_BLE_PROFILE_COUNT || !asked[profile_index]) {
        return false;
    }
    *out = info_by_profile[profile_index];
    return true;
}

enum { STEP_MANU, STEP_MODEL, STEP_NAME, STEP_CONTINUITY, STEP_ANCS, STEP_DONE };

static struct {
    struct bt_conn *conn; /* referenced while running */
    uint8_t profile;
    uint8_t step;
    struct bt_gatt_read_params read;
    struct bt_gatt_discover_params disc;
    char text[3][TEXT_MAX];
    size_t len[3];
    bool continuity;
    bool ancs;
} pr;

static K_MUTEX_DEFINE(pr_lock);
static void step_work_cb(struct k_work *work);
static void watchdog_cb(struct k_work *work);
static void apply_work_cb(struct k_work *work);
static K_WORK_DEFINE(step_work, step_work_cb);
static K_WORK_DELAYABLE_DEFINE(watchdog, watchdog_cb);
static K_WORK_DEFINE(apply_work, apply_work_cb);
static uint8_t apply_profile;

static bool has(int i, const char *needle) {
    size_t k = strlen(needle);
    for (size_t j = 0; j + k <= pr.len[i]; j++) {
        if (strncmp(pr.text[i] + j, needle, k) == 0) {
            return true;
        }
    }
    return false;
}

/* Called with pr_lock held. */
static void end_probe(bool completed) {
    if (!pr.conn) {
        return;
    }
    k_work_cancel_delayable(&watchdog);
    uint8_t p = pr.profile;
    bool ios = has(1, "iPhone") || has(1, "iPad") || has(1, "iPod") || pr.ancs;
    bool mac = has(1, "Mac") || has(1, "iMac");
    bool apple = ios || mac || pr.continuity || has(0, "Apple");
    uint8_t r = ZMK_OS_PROBE_NONE;
    if (apple) {
        r = ios ? ZMK_OS_PROBE_IOS : ZMK_OS_PROBE_MAC; /* Apple without a model: a Mac is likelier */
    } else if (pr.len[0]) {
        r = ZMK_OS_PROBE_NOT_APPLE;
    }
    LOG_INF("os detection: host manufacturer=\"%.*s\" model=\"%.*s\" name=\"%.*s\" continuity=%d ancs=%d -> %d%s",
            (int)pr.len[0], pr.text[0], (int)pr.len[1], pr.text[1], (int)pr.len[2], pr.text[2], pr.continuity, pr.ancs,
            r, completed ? "" : " (timed out)");
    struct zmk_os_probe_info *dst = &info_by_profile[p];
    memset(dst, 0, sizeof(*dst));
    memcpy(dst->manufacturer, pr.text[0], MIN(pr.len[0], sizeof(dst->manufacturer) - 1));
    memcpy(dst->model, pr.text[1], MIN(pr.len[1], sizeof(dst->model) - 1));
    memcpy(dst->name, pr.text[2], MIN(pr.len[2], sizeof(dst->name) - 1));
    dst->continuity = pr.continuity;
    result[p] = r;
    asked[p] = completed || pr.len[0] || pr.len[1] || pr.continuity; /* a cut-off probe may run again */
    bt_conn_unref(pr.conn);
    pr.conn = NULL;
    apply_profile = p;
    k_work_submit(&apply_work);
}

static void apply_work_cb(struct k_work *work) {
    ARG_UNUSED(work);
    zmk_os_detection_ble_reclassify(apply_profile);
}

static void watchdog_cb(struct k_work *work) {
    ARG_UNUSED(work);
    k_mutex_lock(&pr_lock, K_FOREVER);
    end_probe(false);
    k_mutex_unlock(&pr_lock);
}

/* Bluetooth callbacks: record, then let the work item start the next step. */
static uint8_t read_cb(struct bt_conn *conn, uint8_t err, struct bt_gatt_read_params *params, const void *data,
                       uint16_t length) {
    ARG_UNUSED(conn);
    ARG_UNUSED(params);
    if (!pr.conn || pr.step >= STEP_CONTINUITY) {
        return BT_GATT_ITER_STOP;
    }
    if (!err && data && length) {
        int i = pr.step;
        size_t n = MIN(length, TEXT_MAX - pr.len[i]);
        memcpy(pr.text[i] + pr.len[i], data, n);
        pr.len[i] += n;
    }
    pr.step++; /* first value (or none) is enough: STOP means no more callbacks for this read */
    k_work_submit(&step_work);
    return BT_GATT_ITER_STOP;
}

static uint8_t discover_cb(struct bt_conn *conn, const struct bt_gatt_attr *attr, struct bt_gatt_discover_params *params) {
    ARG_UNUSED(conn);
    ARG_UNUSED(params);
    if (!pr.conn) {
        return BT_GATT_ITER_STOP;
    }
    if (attr) {
        if (pr.step == STEP_CONTINUITY) {
            pr.continuity = true;
        } else if (pr.step == STEP_ANCS) {
            pr.ancs = true;
        }
    }
    /* Found (STOP: no final callback follows) or discovery finished (attr == NULL): next step. */
    pr.step++;
    k_work_submit(&step_work);
    return BT_GATT_ITER_STOP;
}

static void step_work_cb(struct k_work *work) {
    ARG_UNUSED(work);
    k_mutex_lock(&pr_lock, K_FOREVER);
    while (pr.conn && pr.step < STEP_DONE) {
        int err;
        if (pr.step == STEP_CONTINUITY || pr.step == STEP_ANCS) {
            memset(&pr.disc, 0, sizeof(pr.disc));
            pr.disc.uuid = pr.step == STEP_CONTINUITY ? &continuity_uuid.uuid : &ancs_uuid.uuid;
            pr.disc.func = discover_cb;
            pr.disc.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
            pr.disc.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
            pr.disc.type = BT_GATT_DISCOVER_PRIMARY;
            err = bt_gatt_discover(pr.conn, &pr.disc);
        } else {
            memset(&pr.read, 0, sizeof(pr.read));
            pr.read.func = read_cb;
            pr.read.handle_count = 0; /* read by UUID */
            pr.read.by_uuid.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
            pr.read.by_uuid.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
            pr.read.by_uuid.uuid = pr.step == STEP_MANU    ? BT_UUID_DIS_MANUFACTURER_NAME
                                   : pr.step == STEP_MODEL ? BT_UUID_DIS_MODEL_NUMBER
                                                           : BT_UUID_GAP_DEVICE_NAME;
            err = bt_gatt_read(pr.conn, &pr.read);
        }
        if (!err) {
            k_mutex_unlock(&pr_lock);
            return; /* the callback submits the next step */
        }
        LOG_DBG("os detection: probe step %d not started (%d)", pr.step, err);
        pr.step++;
    }
    end_probe(true);
    k_mutex_unlock(&pr_lock);
}

void zmk_os_detection_probe_start(struct bt_conn *conn, uint8_t profile_index, bool fresh) {
    if (profile_index >= ZMK_BLE_PROFILE_COUNT) {
        return;
    }
    k_mutex_lock(&pr_lock, K_FOREVER);
    if (pr.conn || (asked[profile_index] && !fresh)) {
        k_mutex_unlock(&pr_lock);
        return; /* one at a time; once per slot per power-up unless newly paired */
    }
    struct bt_conn_info info;
    if (bt_conn_get_info(conn, &info) || info.state != BT_CONN_STATE_CONNECTED || bt_conn_get_security(conn) < BT_SECURITY_L2) {
        k_mutex_unlock(&pr_lock);
        return;
    }
    if (fresh) {
        result[profile_index] = ZMK_OS_PROBE_NONE;
    }
    memset(pr.text, 0, sizeof(pr.text));
    memset(pr.len, 0, sizeof(pr.len));
    pr.continuity = false;
    pr.ancs = false;
    pr.profile = profile_index;
    pr.step = STEP_MANU;
    pr.conn = bt_conn_ref(conn);
    k_work_reschedule(&watchdog, WATCHDOG);
    k_work_submit(&step_work);
    k_mutex_unlock(&pr_lock);
}

static void disconnected(struct bt_conn *conn, uint8_t reason) {
    ARG_UNUSED(reason);
    k_mutex_lock(&pr_lock, K_FOREVER);
    if (pr.conn == conn) {
        end_probe(false); /* late callbacks see pr.conn == NULL and do nothing */
    }
    k_mutex_unlock(&pr_lock);
}

BT_CONN_CB_DEFINE(probe_conn_cb) = {
    .disconnected = disconnected,
};
