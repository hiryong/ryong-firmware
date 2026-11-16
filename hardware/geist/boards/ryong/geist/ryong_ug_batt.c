/*
 * geist geist-UG4: underglow (14 x SK6812MINI-HS) off on a low battery.
 * SK6812MINI-HS runs from VDD (no boost) through U84 TPS2553 (0.31-0.40 A limit) and C42-C46 (5 x 330 uF).
 * On battery the LED supply follows the cell: off at <= 40 % keeps it >= 3.5 V at the bottom of the 1 kHz
 * ripple (blue Vf 3.0-3.2 V + driver); allowed again at >= 50 % (hysteresis). Plain USB keeps the same guard
 * (charging first, and with no battery 0.40 A + key LEDs could pass the 450 mA input limit). A 1.5 A / 3 A
 * charger: always allowed.
 * No battery on plain USB reads 0 %: off. If the user had it on when it was switched off, it comes back by itself.
 */
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zmk/event_manager.h>
#include <zmk/events/battery_state_changed.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/battery.h>
#include <zmk/usb.h>
#include <zmk/rgb_underglow.h>
#include "ryong_keyleds.h"


LOG_MODULE_REGISTER(ryong_ug_batt, CONFIG_ZMK_LOG_LEVEL);

static bool low, restore;

void ryong_ug_batt_recheck(void)
{
    bool now = ryong_ug_batt_low(low, zmk_usb_is_powered(), ryong_charger_fast(), zmk_battery_state_of_charge());
    bool on = false;
    zmk_rgb_underglow_get_state(&on);
    if (now && on) {
        /* entering low (or the user turned it on while low): remember only the first time */
        if (!low) {
            restore = true;
        }
        LOG_INF("battery low: underglow off");
        zmk_rgb_underglow_off();
    } else if (!now && low && restore) {
        LOG_INF("battery ok / USB: underglow back on");
        restore = false;
        zmk_rgb_underglow_on();
    }
    if (!now) {
        restore = false;
    }
    low = now;
    ryong_keyleds_rebudget(); /* the key LED budget keeps a reserve only while underglow is on */
}

static int ug_batt_listener(const zmk_event_t *eh)
{
    ryong_ug_batt_recheck();
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_ug_batt, ug_batt_listener);
ZMK_SUBSCRIPTION(ryong_ug_batt, zmk_battery_state_changed);
ZMK_SUBSCRIPTION(ryong_ug_batt, zmk_usb_conn_state_changed);
