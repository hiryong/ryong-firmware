/* SPDX-License-Identifier: MIT */
/*
 * Bond history: the last few changes of which host is registered on which slot, and why
 * (paired, cleared from the web page, cleared with a key, all cleared, pairing refused). Kept in
 * flash so a "my slot is suddenly empty" report can be explained afterwards. No addresses.
 *
 * zmk_ble_bond_event() is called from ZMK's ble.c in the Bluetooth RX thread or the system work
 * queue: it only records in RAM; the flash write is deferred to a work item.
 */
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zmk/ble.h>
#include <zmk/workqueue.h>
#include <ryong/ble_profile_store.h>

#define LOG_MAX 8
#define KEY_LOG "ryong_btlog/store"
#define KEY_BOOT "ryong_btlog/boot"

struct stored {
    uint8_t count;
    struct ryong_bt_bond_event e[LOG_MAX]; /* newest first */
};

static struct stored store;
static uint16_t boot;
static bool boot_counted;
static struct k_spinlock lock;
static atomic_t from_site;

void ryong_bt_log_site_clear(bool active) { atomic_set(&from_site, active ? 1 : 0); }

static void save_work_cb(struct k_work *work) {
    ARG_UNUSED(work);
    struct stored copy;
    k_spinlock_key_t key = k_spin_lock(&lock);
    copy = store;
    k_spin_unlock(&lock, key);
    (void)settings_save_one(KEY_LOG, &copy, sizeof(copy));
}
static K_WORK_DEFINE(save_work, save_work_cb);

void zmk_ble_bond_event(uint8_t profile, enum zmk_ble_bond_cause cause) {
    uint8_t c = (uint8_t)cause;
    if (cause == ZMK_BLE_BOND_CLEARED) {
        c = atomic_get(&from_site) ? RY_BT_EVENT_CLEARED_SITE : RY_BT_EVENT_CLEARED_KEY;
    }
    k_spinlock_key_t key = k_spin_lock(&lock);
    if (store.count && store.e[0].boot == boot && store.e[0].slot == profile && store.e[0].cause == c) {
        k_spin_unlock(&lock, key); /* the same thing again (a host retrying): keep the history readable */
        return;
    }
    memmove(&store.e[1], &store.e[0], sizeof(store.e[0]) * (LOG_MAX - 1));
    store.e[0] = (struct ryong_bt_bond_event){.boot = boot, .slot = profile, .cause = c};
    if (store.count < LOG_MAX) store.count++;
    k_spin_unlock(&lock, key);
    k_work_submit_to_queue(zmk_workqueue_lowprio_work_q(), &save_work);
}

int ryong_bt_bond_history(struct ryong_bt_bond_event *out, int max, uint16_t *current_boot) {
    k_spinlock_key_t key = k_spin_lock(&lock);
    int n = MIN(max, store.count);
    memcpy(out, store.e, sizeof(out[0]) * n);
    *current_boot = boot;
    k_spin_unlock(&lock, key);
    return n;
}

static int bond_log_set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg) {
    if (settings_name_steq(name, "store", NULL)) {
        struct stored s;
        if (len != sizeof(s) || read_cb(cb_arg, &s, sizeof(s)) != sizeof(s) || s.count > LOG_MAX) return 0;
        store = s;
        return 0;
    }
    if (settings_name_steq(name, "boot", NULL)) {
        if (len == sizeof(boot)) (void)read_cb(cb_arg, &boot, sizeof(boot));
        return 0;
    }
    return -ENOENT;
}

/* After settings are loaded: this power-up is boot n+1 (one small write per power-up). */
static void boot_work_cb(struct k_work *work) {
    ARG_UNUSED(work);
    (void)settings_save_one(KEY_BOOT, &boot, sizeof(boot));
}
static K_WORK_DEFINE(boot_work, boot_work_cb);

static int bond_log_commit(void) {
    if (!boot_counted) {
        boot_counted = true;
        boot++;
        k_work_submit_to_queue(zmk_workqueue_lowprio_work_q(), &boot_work);
    }
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(ryong_bt_log, "ryong_btlog", NULL, bond_log_set, bond_log_commit, NULL);
