/* SPDX-License-Identifier: MIT */
#include <zephyr/kernel.h>
#include <zephyr/bluetooth/addr.h>
#include <cormoran/zmk/custom_settings.h>
#include <zmk/ble.h>
#include <ryong/host_bond.h>
#include <string.h>

/* Store the real paired address privately. Never expose it over Studio RPC. */
#define EMPTY_OWNER {.type = ZMK_CUSTOM_SETTING_VALUE_TYPE_BYTES, .size = 0}
static const struct zmk_custom_setting_value defaults[8] = {
    EMPTY_OWNER, EMPTY_OWNER, EMPTY_OWNER, EMPTY_OWNER,
    EMPTY_OWNER, EMPTY_OWNER, EMPTY_OWNER, EMPTY_OWNER,
};
BUILD_ASSERT(ZMK_BLE_PROFILE_COUNT <= 8);
BUILD_ASSERT(sizeof(bt_addr_le_t) <= CONFIG_ZMK_CUSTOM_SETTINGS_VALUE_MAX_SIZE);
ZMK_CUSTOM_SETTING_ARRAY_DEFINE(ryong_host_owner, "ryong__host_layout", "bond_owner_v1",
    ZMK_CUSTOM_SETTING_VALUE_TYPE_BYTES, ZMK_BLE_PROFILE_COUNT, ZMK_BLE_PROFILE_COUNT,
    defaults, ZMK_CUSTOM_SETTING_CONFIDENTIALITY_DEVICE_PRIVATE,
    ZMK_CUSTOM_SETTING_PERMISSION_SECURE, ZMK_CUSTOM_SETTING_PERMISSION_SECURE,
    ZMK_CUSTOM_SETTING_NO_CONSTRAINT);
static K_MUTEX_DEFINE(owner_lock);
static bool reset_pending[ZMK_BLE_PROFILE_COUNT];
static int clear_setting(uint8_t index, const char *name) {
    struct zmk_custom_setting_value value = {.type = ZMK_CUSTOM_SETTING_VALUE_TYPE_INT32, .int32_value = 0};
    return zmk_custom_setting_write_array_by_key("cormoran__os_detection", name, index,
                                                &value, ZMK_CUSTOM_SETTING_WRITE_MODE_PERSIST);
}
int ryong_host_guard_profile(uint8_t index) {
    if (index >= ZMK_BLE_PROFILE_COUNT) return -EINVAL;
    k_mutex_lock(&owner_lock, K_FOREVER);
    const bt_addr_le_t *peer = zmk_ble_profile_address(index);
    bt_addr_le_t peer_copy;
    if (peer) memcpy(&peer_copy, peer, sizeof(peer_copy));
    struct zmk_custom_setting_value old;
    int rc = !peer ? -ENODEV : zmk_custom_setting_read_array_by_key("ryong__host_layout", "bond_owner_v1", index, &old);
    if (!rc && (old.type != ZMK_CUSTOM_SETTING_VALUE_TYPE_BYTES || old.size != sizeof(*peer) || memcmp(old.bytes_value, &peer_copy, sizeof(peer_copy)))) {
        reset_pending[index] = true;
        // Clear both records durably before adopting a new identity. Any failure
        // leaves the old owner tag, so the next operation retries the reset.
        rc = clear_setting(index, "ble_override");
        if (!rc) rc = clear_setting(index, "ble_detected");
        if (!rc) {
            struct zmk_custom_setting_value next = {.type = ZMK_CUSTOM_SETTING_VALUE_TYPE_BYTES, .size = sizeof(*peer)};
            memcpy(next.bytes_value, &peer_copy, sizeof(peer_copy));
            rc = zmk_custom_setting_write_array_by_key("ryong__host_layout", "bond_owner_v1", index, &next, ZMK_CUSTOM_SETTING_WRITE_MODE_PERSIST);
        }
    }
    k_mutex_unlock(&owner_lock);
    return rc;
}
bool ryong_host_take_reset(uint8_t index) {
    if (index >= ZMK_BLE_PROFILE_COUNT) return false;
    k_mutex_lock(&owner_lock, K_FOREVER);
    bool reset = reset_pending[index];
    reset_pending[index] = false;
    k_mutex_unlock(&owner_lock);
    return reset;
}
