/* SPDX-License-Identifier: MIT */
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/random/random.h>
#include <zephyr/settings/settings.h>
#include <zephyr/bluetooth/addr.h>
#include <zmk/ble.h>
#include <ryong/ble_profile_store.h>
#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)
#include <ryong/host_bond.h>
#endif

/* Names live in this module's own settings subtree, bound to the real bonded
 * address, so a re-paired slot never shows the previous host's name. They are
 * not part of custom-settings RPC and the address is never sent to the host. */
BUILD_ASSERT(sizeof(bt_addr_le_t) == RY_BT_ADDR_SIZE);
BUILD_ASSERT(ZMK_BLE_PROFILE_COUNT <= 8);

struct name_slot {
    uint8_t record[RY_BT_RECORD_MAX];
    size_t size;
};
static struct name_slot names[ZMK_BLE_PROFILE_COUNT];
static K_MUTEX_DEFINE(store_lock);
static uint32_t salt;
static bool salted;

static void owner_of(uint8_t index, uint8_t owner[RY_BT_ADDR_SIZE]) {
    const bt_addr_le_t *peer = zmk_ble_profile_address(index);
    if (peer) memcpy(owner, peer, RY_BT_ADDR_SIZE);
    else memset(owner, 0, RY_BT_ADDR_SIZE);
}

static uint32_t token_of(uint8_t index) {
    if (!salted) {
        salt = sys_rand32_get();
        salted = true;
    }
    uint8_t owner[RY_BT_ADDR_SIZE];
    owner_of(index, owner);
    return ry_bt_token(salt, index, owner);
}

static void key_of(uint8_t index, char key[24]) { snprintf(key, 24, "ryong_bt/name/%u", index); }

static int settings_set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg) {
    const char *next;
    if (!settings_name_steq(name, "name", &next) || !next || next[0] < '0' || next[0] > '9' ||
        next[1] != '\0') {
        return -ENOENT;
    }
    uint8_t index = (uint8_t)(next[0] - '0');
    if (index >= ZMK_BLE_PROFILE_COUNT || len > RY_BT_RECORD_MAX) return -EINVAL;
    ssize_t rc = read_cb(cb_arg, names[index].record, len);
    names[index].size = rc == (ssize_t)len ? len : 0;
    return rc < 0 ? (int)rc : 0;
}
SETTINGS_STATIC_HANDLER_DEFINE(ryong_bt, "ryong_bt", NULL, settings_set, NULL, NULL);

static int delete_name(uint8_t index) {
    char key[24];
    key_of(index, key);
    int rc = settings_delete(key);
    if (!rc) names[index].size = 0;
    return rc;
}

int ryong_bt_profiles_count(void) { return ZMK_BLE_PROFILE_COUNT; }
int ryong_bt_profiles_active(void) { return zmk_ble_active_profile_index(); }

int ryong_bt_profile_info(uint8_t index, struct ryong_bt_profile_info *out) {
    if (index >= ZMK_BLE_PROFILE_COUNT || !out) return -EINVAL;
    memset(out, 0, sizeof(*out));
    uint8_t owner[RY_BT_ADDR_SIZE];
    k_mutex_lock(&store_lock, K_FOREVER);
    owner_of(index, owner);
    out->bonded = !ry_bt_owner_empty(owner);
    out->connected = out->bonded && zmk_ble_profile_is_connected(index);
    out->token = token_of(index);
    (void)ry_bt_record_decode(names[index].record, names[index].size, owner, out->name);
    k_mutex_unlock(&store_lock);
    return 0;
}

int ryong_bt_profiles_purge_stale(void) {
    int result = 0;
    k_mutex_lock(&store_lock, K_FOREVER);
    for (uint8_t i = 0; i < ZMK_BLE_PROFILE_COUNT; i++) {
        uint8_t owner[RY_BT_ADDR_SIZE];
        owner_of(i, owner);
        if (ry_bt_record_stale(names[i].record, names[i].size, owner)) {
            int rc = delete_name(i);
            if (rc && !result) result = rc;
        }
    }
    k_mutex_unlock(&store_lock);
    return result;
}

int ryong_bt_profile_rename(uint8_t index, uint32_t token, const char *name, size_t len) {
    if (index >= ZMK_BLE_PROFILE_COUNT || !ry_bt_name_valid(name, len)) return -EINVAL;
    k_mutex_lock(&store_lock, K_FOREVER);
    uint8_t owner[RY_BT_ADDR_SIZE];
    owner_of(index, owner);
    int rc;
    if (ry_bt_owner_empty(owner)) {
        rc = -ENOENT;
    } else if (token != token_of(index)) {
        rc = -ESTALE;
    } else if (len == 0) {
        rc = names[index].size ? delete_name(index) : 0;
    } else {
        uint8_t record[RY_BT_RECORD_MAX];
        size_t size = ry_bt_record_encode(record, owner, name, len);
        char key[24];
        key_of(index, key);
        rc = size ? settings_save_one(key, record, size) : -EINVAL;
        /* RAM changes only after flash accepted the record. */
        if (!rc) {
            memcpy(names[index].record, record, size);
            names[index].size = size;
        }
    }
    k_mutex_unlock(&store_lock);
    return rc;
}

/* BLE profile selection and unpairing run on the system work queue, the same
 * context ZMK uses for its own profile work, never on the Studio RPC thread. */
enum op_kind { OP_SELECT, OP_CLEAR };
static struct {
    enum op_kind kind;
    uint8_t index;
    uint32_t token;
    int rc;
} op;
static K_SEM_DEFINE(op_done, 0, 1);

static void run_op(struct k_work *work) {
    ARG_UNUSED(work);
    if (op.kind == OP_SELECT) {
        op.rc = zmk_ble_prof_select(op.index);
    } else if (!zmk_ble_profile_is_open(op.index) && op.token == token_of(op.index)) {
        int previous = zmk_ble_active_profile_index();
        op.rc = previous == op.index ? 0 : zmk_ble_prof_select(op.index);
        if (!op.rc) {
            zmk_ble_clear_bonds(); /* public API: clears the active slot only */
            if (previous != op.index && previous >= 0) (void)zmk_ble_prof_select((uint8_t)previous);
            op.rc = zmk_ble_profile_is_open(op.index) ? 0 : -EIO;
        }
    } else {
        op.rc = zmk_ble_profile_is_open(op.index) ? -ENOENT : -ESTALE;
    }
    k_sem_give(&op_done);
}
static K_WORK_DEFINE(op_work, run_op);

static int run(enum op_kind kind, uint8_t index, uint32_t token) {
    op.kind = kind;
    op.index = index;
    op.token = token;
    op.rc = -EIO;
    k_sem_reset(&op_done);
    int rc = k_work_submit(&op_work);
    if (rc < 0) return rc;
    k_sem_take(&op_done, K_FOREVER);
    return op.rc;
}

int ryong_bt_profile_select(uint8_t index) {
    if (index >= ZMK_BLE_PROFILE_COUNT) return -EINVAL;
    k_mutex_lock(&store_lock, K_FOREVER);
    int rc = run(OP_SELECT, index, 0);
    k_mutex_unlock(&store_lock);
    return rc;
}

int ryong_bt_profile_clear(uint8_t index, uint32_t token) {
    if (index >= ZMK_BLE_PROFILE_COUNT || !token) return -EINVAL;
    k_mutex_lock(&store_lock, K_FOREVER);
    int rc = run(OP_CLEAR, index, token);
    /* After the bond is gone the name record no longer matches the (empty)
     * owner, so even if power fails here the old name is never shown again;
     * deleting it is cleanup. The OS records follow the same owner rule. */
    if (!rc && names[index].size) rc = delete_name(index);
#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)
    if (!rc) rc = ryong_host_guard_profile(index);
#endif
    k_mutex_unlock(&store_lock);
    return rc;
}
