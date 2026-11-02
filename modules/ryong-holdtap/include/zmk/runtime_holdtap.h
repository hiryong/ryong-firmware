#pragma once

#include <stdint.h>
#include <stdbool.h>

// Runtime-editable hold-tap timing. Mirrors the four tunable devicetree props.
// flavor is stored as the enum flavor index (0..3).
struct rt_holdtap_timing {
    int tapping_term_ms;
    int quick_tap_ms;
    int require_prior_idle_ms;
    uint8_t flavor;
};

// Each zmk,behavior-runtime-hold-tap instance registers its live timing struct
// (the mutable data->t consulted on every keypress) and its devicetree
// defaults at init. If a saved NVS value exists for the slot it is applied to
// *live immediately (or when settings load completes).
// behavior_name is the registering device's dev->name (a static devicetree
// string, stored by pointer); pass NULL if unknown.
int rt_holdtap_register(uint8_t slot, struct rt_holdtap_timing *live,
                         const struct rt_holdtap_timing *dt_default,
                         const char *behavior_name);

// Device name of the behavior that registered `slot`, or NULL if the slot is
// not registered (or was registered without a name).
const char *rt_holdtap_behavior_name(uint8_t slot);

// Fill *out with the slot's current live timing. Returns 0 if the slot is
// registered, negative otherwise.
int rt_holdtap_get(uint8_t slot, struct rt_holdtap_timing *out);

// Persist timing for a slot to NVS (NVS-first), then update the live struct.
// Returns 0 on success, negative on error or unregistered slot.
int rt_holdtap_set(uint8_t slot, const struct rt_holdtap_timing *in);

// Restore the slot's devicetree defaults to the live struct and delete its NVS
// entry. Returns 0 on success.
int rt_holdtap_reset(uint8_t slot);

// True if the slot has a registered instance. Used by the RPC to enumerate.
bool rt_holdtap_registered(uint8_t slot);

// Delete all saved slots from NVS and restore each registered live struct to
// its devicetree defaults (ZMK Studio settings reset).
void rt_holdtap_clear_all(void);

