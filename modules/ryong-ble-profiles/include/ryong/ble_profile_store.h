/* SPDX-License-Identifier: MIT */
#ifndef RYONG_BLE_PROFILE_STORE_H
#define RYONG_BLE_PROFILE_STORE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <ryong/ble_profile_core.h>

struct ryong_bt_profile_info {
    bool bonded;
    bool connected;
    uint32_t token;
    char name[RY_BT_NAME_MAX + 1];
};

int ryong_bt_profiles_count(void);
int ryong_bt_profiles_active(void);
int ryong_bt_profile_info(uint8_t index, struct ryong_bt_profile_info *out);
int ryong_bt_profile_select(uint8_t index);
/* token must match the current bond; an empty name removes the label. */
int ryong_bt_profile_rename(uint8_t index, uint32_t token, const char *name, size_t len);
/* Removes only the keyboard-side bond, its name and per-profile OS records.
 * The host keeps its own pairing entry; that cannot be removed remotely. */
int ryong_bt_profile_clear(uint8_t index, uint32_t token);
/* Deletes names left behind by a bond that changed outside this RPC. */
int ryong_bt_profiles_purge_stale(void);
#endif
