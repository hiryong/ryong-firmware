#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <ryong/host_layout.h>
int main(void) {
    struct ry_layout_state s = {0}; uint32_t usage;
    assert(ry_layout_press(&s, 1, 0x700e2, 0x700e3, &usage) && usage == 0x700e2);
    assert(!ry_layout_press(&s, 1, 1, 2, &usage));
    ry_layout_observe(&s, true, 100, 2000);
    ry_layout_tick(&s, 2200, 1); assert(!s.apple);
    assert(ry_layout_release(&s, 1, &usage) && usage == 0x700e2);
    ry_layout_tick(&s, 2200, 0); assert(s.apple);
    assert(ry_layout_press(&s, 1, 0x700e2, 0x700e3, &usage) && usage == 0x700e3);
    ry_layout_endpoint_reset(&s, 1); assert(s.apple);
    assert(ry_layout_release(&s, 1, &usage) && usage == 0x700e3);
    ry_layout_tick(&s, 2201, 0); assert(!s.apple);
    ry_layout_observe(&s, true, 3000, 2000);
    ry_layout_observe(&s, false, 3500, 2000);
    ry_layout_tick(&s, 6000, 0); assert(!s.apple);
    assert(!ry_layout_release(&s, 1, &usage));
    assert(!ry_layout_press(&s, 96, 1, 2, &usage));
    assert(!ry_layout_press(&s, 2, 0, 2, &usage));
    assert(ry_layout_apple_of(0x700e2) == 0x700e3 && ry_layout_apple_of(0x700e3) == 0x700e2);
    assert(ry_layout_apple_of(0x700e6) == 0x700e7 && ry_layout_apple_of(0x700e7) == 0x700e6);
    assert(ry_layout_apple_of(0x700e0) == 0x700e0 && ry_layout_apple_of(0x70004) == 0x70004);
    puts("Adaptive physical key: debounce, held-key latching, endpoint fallback, bounds passed");
}
