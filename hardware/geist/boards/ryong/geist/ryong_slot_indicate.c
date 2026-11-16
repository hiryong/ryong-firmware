/*
 * geist: Bluetooth slot light on the slot key itself.
 *
 * ZMK's slot light (ble_indicator.c: pairing = fast blink, waiting = slow blink, connected = on 1 s,
 * cleared = one flash; on/off, signals and brightness from keys.ryong.com) normally drives the whole
 * backlight through zmk_backlight_indicate(). geist can light one key alone, so this wrapper sends the
 * same animation to the key(s) bound to the active slot instead:
 *   &bt_slot N, &bt BT_SEL N, or a macro named BT_Profile<N> (older keys.ryong.com keymaps),
 *   on any key position and any layer. The keymap is searched on every call, so moving the slot keys
 *   in ZMK Studio moves the light with them. No key bound to the slot: the whole backlight, as before.
 * Linked with -Wl,--wrap=zmk_backlight_indicate (CMakeLists.txt).
 */
#include <zephyr/kernel.h>
#include <string.h>
#include <strings.h>
#include <stdlib.h>
#include <dt-bindings/zmk/bt.h>
#include <zmk/ble.h>
#include <zmk/behavior.h>
#include <zmk/keymap.h>
#include <zmk/matrix.h>
#include "ryong_keyleds.h"

int __real_zmk_backlight_indicate(int level);

static uint8_t keys[RYONG_KEYLED_COUNT];
static uint8_t nkeys;
static bool on_keys;

static int binding_slot(const struct zmk_behavior_binding *b) {
    if (b == NULL || b->behavior_dev == NULL) {
        return -1;
    }
    const char *n = b->behavior_dev;
    if (strcmp(n, "bt_slot") == 0) {
        return (int)b->param1;
    }
    if ((strcmp(n, "bluetooth") == 0 || strcmp(n, "bt") == 0) && b->param1 == BT_SEL_CMD) {
        return (int)b->param2;
    }
    if (strncasecmp(n, "BT_Profile", 10) == 0 && n[10] >= '0' && n[10] <= '9') {
        return atoi(n + 10);
    }
    return -1;
}

static uint8_t find_keys(int slot, uint8_t *out) {
    uint8_t n = 0;
    for (int pos = 0; pos < ZMK_KEYMAP_LEN && pos < RYONG_KEYLED_COUNT; pos++) {
        for (int li = 0; li < ZMK_KEYMAP_LAYERS_LEN; li++) {
            zmk_keymap_layer_id_t id = zmk_keymap_layer_index_to_id(li);
            if (id == ZMK_KEYMAP_LAYER_ID_INVAL) {
                continue;
            }
            if (binding_slot(zmk_keymap_get_layer_binding_at_idx(id, pos)) == slot) {
                out[n++] = pos;
                break;
            }
        }
    }
    return n;
}

static void release_keys(void) {
    for (int i = 0; i < nkeys; i++) {
        ryong_keyled_override(keys[i], -1);
    }
    nkeys = 0;
    on_keys = false;
}

/* Site brightness 1..100 (default 1 = "dim") -> one key LED 8..100: a single key at the whole
 * backlight's lowest step is hard to see, so the scale starts where one key is still visible. */
static int key_level(int level) {
    if (level <= 0) {
        return 0;
    }
    return 8 + (MIN(level, 100) - 1) * 92 / 99;
}

int __wrap_zmk_backlight_indicate(int level) {
    if (level < 0) {
        if (on_keys) {
            release_keys();
            return 0;
        }
        return __real_zmk_backlight_indicate(level);
    }
    uint8_t found[RYONG_KEYLED_COUNT];
    uint8_t n = find_keys(zmk_ble_active_profile_index(), found);
    if (n == 0) {
        if (on_keys) {
            release_keys();
        }
        return __real_zmk_backlight_indicate(level);
    }
    if (!on_keys) {
        /* the whole-backlight form may have been started before a key was bound: end it */
        __real_zmk_backlight_indicate(-1);
    }
    if (on_keys && (n != nkeys || memcmp(found, keys, n) != 0)) {
        release_keys();
    }
    memcpy(keys, found, n);
    nkeys = n;
    on_keys = true;
    for (int i = 0; i < n; i++) {
        ryong_keyled_override(keys[i], key_level(level));
    }
    return 0;
}
