#include "ryong_fw/host_policy.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
    ry_host_policy_t p;
    ry_host_policy_init(&p);
    assert(!ry_host_should_swap(&p.ble[0]));
    assert(ry_host_bind(&p.ble[0], 10));
    assert(ry_host_bind(&p.ble[1], 20));
    assert(!ry_host_observe(&p.ble[0], 10, RY_OS_MACOS, false));
    assert(!ry_host_should_swap(&p.ble[0]));
    assert(ry_host_latched_swap(&p.ble[0], 1, true));
    assert(!ry_host_latched_swap(&p.ble[0], 0, true));
    assert(ry_host_observe(&p.ble[0], 10, RY_OS_MACOS, true));
    assert(ry_host_observe(&p.ble[1], 20, RY_OS_WINDOWS, true));
    assert(ry_host_should_swap(&p.ble[0]));
    assert(!ry_host_should_swap(&p.ble[1]));
    assert(!ry_host_latched_swap(&p.ble[0], 1, false));
    assert(ry_host_latched_swap(&p.ble[0], 0, false));
    assert(ry_host_override(&p.ble[0], RY_OS_WINDOWS));
    assert(!ry_host_should_swap(&p.ble[0]));
    assert(ry_host_observe(&p.ble[0], 10, RY_OS_MACOS, true));
    assert(!ry_host_should_swap(&p.ble[0])); /* manual wins */
    assert(ry_host_override(&p.ble[0], RY_OS_UNKNOWN));
    assert(ry_host_should_swap(&p.ble[0]));
    assert(!ry_host_observe(&p.ble[0], 9, RY_OS_WINDOWS, true));
    assert(!ry_host_observe(&p.ble[0], 10, RY_OS_UNKNOWN, true));
    assert(ry_host_should_swap(&p.ble[0]));
    assert(ry_host_bind(&p.usb, 1));
    assert(ry_host_observe(&p.usb, 1, RY_OS_WINDOWS, true));
    assert(ry_host_should_swap(&p.ble[0])); /* USB cannot contaminate BLE */
    assert(ry_host_bind(&p.ble[0], 11)); /* replacement host must not inherit */
    assert(ry_host_effective_os(&p.ble[0]) == RY_OS_UNKNOWN);
    assert(!ry_host_should_swap(&p.ble[0]));
    assert(ry_host_modifier_usage(0xe2, true, false) == 0xe3);
    assert(ry_host_modifier_usage(0xe3, true, false) == 0xe2);
    assert(ry_host_modifier_usage(0xe6, true, false) == 0xe6);
    assert(ry_host_modifier_usage(0xe6, true, true) == 0xe7);
    assert(ry_host_modifier_usage(0xe7, true, true) == 0xe6);
    assert(ry_host_modifier_usage(0x04, true, true) == 0x04);
    assert(ry_host_modifier_usage(0xe2, false, true) == 0xe2);
    p.ble[1].base_layout = RY_LAYOUT_APPLE;
    assert(ry_host_should_swap(&p.ble[1])); /* avoid double swapping Mac base */
    assert(ry_host_override(&p.ble[1], RY_OS_MACOS));
    assert(!ry_host_should_swap(&p.ble[1]));
    p.ble[1].base_layout = RY_LAYOUT_UNCHANGED;
    assert(!ry_host_should_swap(&p.ble[1]));
    assert(!ry_host_override(&p.ble[1], (ry_host_os_t)99));
    puts("Host OS policy: all tests passed (host-only; not BLE detection).");
    return 0;
}
