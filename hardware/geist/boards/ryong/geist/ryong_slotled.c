/*
 * geist Ver2: the Bluetooth slot key shows its own state with its own LED.
 *
 * Which key: every keymap position, on any layer, bound to the active profile's slot, either directly
 * (&bt BT_SEL n) or through a macro named BT_Profile<n> (what keys.ryong.com generates). So moving the
 * slot keys to any position in the keymap or ZMK Studio moves the light with them; nothing is fixed to
 * Q/W/E/R. The keymap is searched again on every event, so live Studio edits are followed too.
 *
 * What it shows (on top of whatever the backlight is doing, at CONFIG_RYONG_SLOT_LED_LEVEL):
 *   slot open for pairing (no bond)   fast blink, 250 ms, for up to 60 s
 *   bonded, not connected (searching) slow blink, 500 ms, until connected or 30 s
 *   connected                         two short flashes, then the key returns to the backlight
 */
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <string.h>
#include <strings.h>
#include <stdlib.h>
#include <dt-bindings/zmk/bt.h>
#include <zmk/ble.h>
#include <zmk/behavior.h>
#include <zmk/keymap.h>
#include <zmk/matrix.h>
#include <zmk/event_manager.h>
#include <zmk/events/ble_active_profile_changed.h>
#include "ryong_keyleds.h"

LOG_MODULE_REGISTER(ryong_slotled, CONFIG_ZMK_LOG_LEVEL);

#define FAST_MS 250
#define SLOW_MS 500
#define FLASH_MS 120
#define OPEN_LIMIT_MS 60000
#define SEARCH_LIMIT_MS 30000

enum mode { M_IDLE, M_OPEN, M_SEARCH, M_FLASH };

static struct {
    uint8_t keys[RYONG_KEYLED_COUNT];
    uint8_t nkeys;
    enum mode mode;
    bool on;
    int steps;      /* remaining toggles (flash) or remaining time in half periods */
} st;

static void blink_fn(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(blink_work, blink_fn);

/* behavior name -> slot it selects, or -1 */
static int binding_slot(const struct zmk_behavior_binding *b)
{
    if (b == NULL || b->behavior_dev == NULL) {
        return -1;
    }
    const char *n = b->behavior_dev;
    if ((strcmp(n, "bluetooth") == 0 || strcmp(n, "bt") == 0) && b->param1 == BT_SEL_CMD) {
        return (int)b->param2;
    }
    if (strncasecmp(n, "BT_Profile", 10) == 0 && n[10] >= '0' && n[10] <= '9') {
        return atoi(n + 10);
    }
    return -1;
}

static void find_keys(int slot)
{
    st.nkeys = 0;
    for (int pos = 0; pos < ZMK_KEYMAP_LEN && pos < RYONG_KEYLED_COUNT; pos++) {
        for (int li = 0; li < ZMK_KEYMAP_LAYERS_LEN; li++) {
            zmk_keymap_layer_id_t id = zmk_keymap_layer_index_to_id(li);
            if (id == ZMK_KEYMAP_LAYER_ID_INVAL) {
                continue;
            }
            if (binding_slot(zmk_keymap_get_layer_binding_at_idx(id, pos)) == slot) {
                st.keys[st.nkeys++] = pos;
                break;
            }
        }
    }
}

static void show(int value)
{
    for (int i = 0; i < st.nkeys; i++) {
        ryong_keyled_override(st.keys[i], value);
    }
}

static void stop(void)
{
    k_work_cancel_delayable(&blink_work);
    show(-1);
    st.mode = M_IDLE;
}

static void blink_fn(struct k_work *work)
{
    if (st.mode == M_IDLE) {
        return;
    }
    if (st.steps-- <= 0) {
        stop();
        return;
    }
    st.on = !st.on;
    show(st.on ? CONFIG_RYONG_SLOT_LED_LEVEL : 0);
    k_work_schedule(&blink_work,
                    K_MSEC(st.mode == M_FLASH ? FLASH_MS : st.mode == M_OPEN ? FAST_MS : SLOW_MS));
}

static int slotled_listener(const zmk_event_t *eh)
{
    const struct zmk_ble_active_profile_changed *ev = as_zmk_ble_active_profile_changed(eh);
    if (ev == NULL) {
        return ZMK_EV_EVENT_BUBBLE;
    }
    stop();
    find_keys(ev->index);
    if (st.nkeys == 0) {
        return ZMK_EV_EVENT_BUBBLE; /* no key bound to this slot: nothing to show */
    }
    if (zmk_ble_active_profile_is_connected()) {
        st.mode = M_FLASH;
        st.steps = 4; /* on, off, on, off */
    } else if (zmk_ble_active_profile_is_open()) {
        st.mode = M_OPEN;
        st.steps = OPEN_LIMIT_MS / FAST_MS;
    } else {
        st.mode = M_SEARCH;
        st.steps = SEARCH_LIMIT_MS / SLOW_MS;
    }
    st.on = false;
    LOG_DBG("slot %d: %d key(s), mode %d", ev->index, st.nkeys, st.mode);
    k_work_schedule(&blink_work, K_NO_WAIT);
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(ryong_slotled, slotled_listener);
ZMK_SUBSCRIPTION(ryong_slotled, zmk_ble_active_profile_changed);
