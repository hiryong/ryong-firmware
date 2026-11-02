#ifndef RYONG_HOST_POLICY_H
#define RYONG_HOST_POLICY_H
#include <stdbool.h>
#include <stdint.h>

/* Policy prototype; the ZMK endpoint/settings adapter is not connected yet. */
#define RY_HOST_BLE_PROFILES 5u
typedef enum { RY_OS_UNKNOWN, RY_OS_WINDOWS, RY_OS_MACOS, RY_OS_LINUX,
               RY_OS_IOS, RY_OS_ANDROID } ry_host_os_t;
typedef enum { RY_LAYOUT_WINDOWS, RY_LAYOUT_APPLE, RY_LAYOUT_UNCHANGED } ry_host_layout_t;
typedef struct {
    uint32_t bond_generation;
    ry_host_os_t detected;
    ry_host_os_t override_os; /* UNKNOWN = AUTO */
    ry_host_layout_t base_layout;
} ry_host_profile_t;
typedef struct {
    ry_host_profile_t ble[RY_HOST_BLE_PROFILES];
    ry_host_profile_t usb; /* Never substitute USB observations for BLE state. */
} ry_host_policy_t;

void ry_host_policy_init(ry_host_policy_t *policy);
bool ry_host_bind(ry_host_profile_t *profile, uint32_t bond_generation);
bool ry_host_override(ry_host_profile_t *profile, ry_host_os_t os);
bool ry_host_observe(ry_host_profile_t *profile, uint32_t bond_generation,
                     ry_host_os_t os, bool settled);
ry_host_os_t ry_host_effective_os(const ry_host_profile_t *profile);
bool ry_host_should_swap(const ry_host_profile_t *profile);
/* Hold the current mapping until ALL keys are released. */
bool ry_host_latched_swap(const ry_host_profile_t *profile, unsigned held_keys, bool current_swap);
/* For explicitly OS-adaptive physical bindings ONLY. Never rewrite macro HID
 * output or saved keymaps globally. Capture the result on press and use that
 * same usage on release, even after a profile/OS change. */
uint16_t ry_host_modifier_usage(uint16_t usage, bool swap, bool swap_right);
#endif
