/*
 * geist Ver2: 61 white key LEDs on one IS31FL3746A (U81, I2C 0x60), 18 CS x 4 SW matrix, 1/4 scan.
 * SW1..SW4 = key rows 0..3 (row 4 shares SW3/SW4). CS lines follow the key columns, numbered by the side of
 * the chip they leave from (left pins -> left columns); four CS lines serve the bottom row.
 *
 * One LED device for ZMK:
 *   led 0      -> every key at the same brightness (zmk,backlight uses this, so Fn+Z/X/C and auto-off
 *                 keep working exactly like rev1.0)
 *   led 1 + n  -> key n only (keymap position n); ryong_keyled_override() does the same for board code
 *
 * Brightness is set with each dot's DC scaling (SL, peak current) and PWM fixed at 255: the weakest light
 * flows the smallest peak current, so a dim slot-key blink keeps full brightness down to an empty battery
 * (white LED Vf falls with current) and the supply sees an almost steady load (4 scan slots, 14-18 dots).
 * Power budget: the chip's global current (GCC) is lowered so the estimated average LED current stays
 * under CONFIG_RYONG_LED_BUDGET_USB_MA on USB / _BAT_MA on battery (minus a reserve while underglow is on).
 * When every key is dark the chip is blanked, SDB (P0.03) goes low and U83 cuts VCC_LED: 0 uA.
 */
#define DT_DRV_COMPAT ryong_keyleds

#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/led.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <string.h>
#include <drivers/is31fl3746a.h>
#include "ryong_keyleds.h"
#include <zmk/event_manager.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/usb.h>
#include <zmk/activity.h>
#if IS_ENABLED(CONFIG_RYONG_LED_BAT_AUTO_CAP)
#include <zmk/battery.h>
#include <zmk/events/battery_state_changed.h>
#endif
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
#include <zmk/rgb_underglow.h>
#endif

LOG_MODULE_REGISTER(ryong_keyleds, CONFIG_LED_LOG_LEVEL);

/* after the IS31FL3746A driver (LED init priority), before ZMK backlight (APPLICATION level) */
#define KEYLEDS_INIT_PRIORITY 91
BUILD_ASSERT(CONFIG_LED_INIT_PRIORITY < KEYLEDS_INIT_PRIORITY, "keyleds must init after IS31FL3746A");

/* average current of one dot at SL = 255, PWM = 255, GCC = 255 with RISET 18k: 343/18k*255/256 /4.14
 * (devicetree current-limit 255 = 19.0 mA peak / 4.6 mA average per LED; LITEON LTW-C230DS is rated 20 mA,
 * so even a wrong GCC cannot overdrive it - the limit is set by R20 in hardware) */
#define DOT_FULL_UA 4585U

/* keymap position -> dot (SW-1)*18 + (CS-1); generated from the KiCad board */
static const uint8_t map[RYONG_KEYLED_COUNT] = {
    16, /*  0 Esc                BL14 SW1 CS17 */
    15, /*  1 1                  BL13 SW1 CS16 */
    14, /*  2 2                  BL12 SW1 CS15 */
    13, /*  3 3                  BL11 SW1 CS14 */
    11, /*  4 4                  BL10 SW1 CS12 */
    12, /*  5 5                  BL9  SW1 CS13 */
    10, /*  6 6                  BL8  SW1 CS11 */
     0, /*  7 7                  BL7  SW1 CS1 */
     6, /*  8 8                  BL6  SW1 CS7 */
     3, /*  9 9                  BL5  SW1 CS4 */
     4, /* 10 0                  BL4  SW1 CS5 */
     5, /* 11 -                  BL3  SW1 CS6 */
     2, /* 12 =                  BL2  SW1 CS3 */
     1, /* 13 Backspace          BL1  SW1 CS2 */
    34, /* 14 Tab                BL28 SW2 CS17 */
    33, /* 15 Q                  BL27 SW2 CS16 */
    32, /* 16 W                  BL26 SW2 CS15 */
    31, /* 17 E                  BL25 SW2 CS14 */
    29, /* 18 R                  BL24 SW2 CS12 */
    30, /* 19 T                  BL23 SW2 CS13 */
    28, /* 20 Y                  BL22 SW2 CS11 */
    18, /* 21 U                  BL21 SW2 CS1 */
    24, /* 22 I                  BL20 SW2 CS7 */
    21, /* 23 O                  BL19 SW2 CS4 */
    22, /* 24 P                  BL18 SW2 CS5 */
    23, /* 25 [                  BL17 SW2 CS6 */
    20, /* 26 ]                  BL16 SW2 CS3 */
    19, /* 27 \\                 BL15 SW2 CS2 */
    52, /* 28 CapsLock           BL41 SW3 CS17 */
    50, /* 29 A                  BL40 SW3 CS15 */
    49, /* 30 S                  BL39 SW3 CS14 */
    47, /* 31 D                  BL38 SW3 CS12 */
    48, /* 32 F                  BL37 SW3 CS13 */
    46, /* 33 G                  BL36 SW3 CS11 */
    36, /* 34 H                  BL35 SW3 CS1 */
    42, /* 35 J                  BL34 SW3 CS7 */
    39, /* 36 K                  BL33 SW3 CS4 */
    40, /* 37 L                  BL32 SW3 CS5 */
    41, /* 38 ;                  BL31 SW3 CS6 */
    38, /* 39 '                  BL30 SW3 CS3 */
    37, /* 40 Enter              BL29 SW3 CS2 */
    70, /* 41 LShift             BL53 SW4 CS17 */
    68, /* 42 Z                  BL52 SW4 CS15 */
    67, /* 43 X                  BL51 SW4 CS14 */
    65, /* 44 C                  BL50 SW4 CS12 */
    66, /* 45 V                  BL49 SW4 CS13 */
    64, /* 46 B                  BL48 SW4 CS11 */
    54, /* 47 N                  BL47 SW4 CS1 */
    60, /* 48 M                  BL46 SW4 CS7 */
    57, /* 49 ,                  BL45 SW4 CS4 */
    58, /* 50 .                  BL44 SW4 CS5 */
    59, /* 51 /                  BL43 SW4 CS6 */
    55, /* 52 RShift             BL42 SW4 CS2 */
    53, /* 53 Bottom-L1 (1.25u)  BL61 SW3 CS18 */
    51, /* 54 Bottom-L2 (1.25u)  BL60 SW3 CS16 */
    71, /* 55 Bottom-L3 (1.25u)  BL59 SW4 CS18 */
    63, /* 56 Space (6.25u)      BL58 SW4 CS10 */
    62, /* 57 Bottom-R1 (1.25u)  BL57 SW4 CS9 */
    43, /* 58 Bottom-R2 (1.25u)  BL56 SW3 CS8 */
    56, /* 59 Bottom-R3 (1.25u)  BL55 SW4 CS3 */
    61, /* 60 Bottom-R4 (1.25u)  BL54 SW4 CS8 */
};

struct keyleds_config {
    const struct device *drv;
    struct gpio_dt_spec sdb;
    uint8_t gcc_full; /* the driver node's current-limit */
};

struct keyleds_data {
    uint8_t level;                      /* backlight level 0..100 */
    uint8_t last_on;                    /* last level above 0 that ZMK set */
    uint8_t prox_level;                 /* level Smart Backlight may show: the one ZMK turned off for idle */
    bool prox;                          /* Smart Backlight: hands near */
    uint16_t fade_p;                    /* Smart Backlight fade position 0..1000 (shown = prox_level x p^2) */
    bool away;                          /* Smart Backlight: hands gone while ZMK still keeps the level on */
    uint16_t away_p;                    /* 1000 = level shown as is, 0 = dark */
    int8_t over[RYONG_KEYLED_COUNT];    /* -1 = follow level */
    uint8_t sl[IS31FL3746A_DOTS];
    uint8_t gcc_written;
    bool awake;
    bool ready;
    bool ug_on;
    uint8_t open[IS31FL3746A_DOTS / 8];
    struct k_mutex lock;
};

static const struct device *self;

/* Smart Backlight fade (geist-UG4-SB): keys lit by the hands come up and go down gradually.
 * The fade position p runs 0..1000 in FADE_STEP_MS steps; the level shown is prox_level x (p/1000)^2, so the
 * steps are small near dark where the eye notices them most. Resolution 0.1 % of a level (SL 0..255). */
#ifndef CONFIG_RYONG_SBL_FADE_IN_MS
#define CONFIG_RYONG_SBL_FADE_IN_MS 600
#endif
#ifndef CONFIG_RYONG_SBL_FADE_OUT_MS
#define CONFIG_RYONG_SBL_FADE_OUT_MS 1500
#endif
#define FADE_STEP_MS 20
#define FADE_FULL 1000U

static void fade_fn(struct k_work *w);
static K_WORK_DELAYABLE_DEFINE(fade_work, fade_fn);

/* brightness of key k in 0.1 % units (0..1000) */
static int key_milli(const struct keyleds_data *d, int k)
{
    if (d->over[k] >= 0) {
        return d->over[k] * 10;
    }
    if (d->level) {
        uint32_t a = d->away_p;
        return (int)((uint32_t)d->level * 10U * a * a / (FADE_FULL * FADE_FULL));
    }
    uint32_t p = d->fade_p;
    return (int)((uint32_t)d->prox_level * 10U * p * p / (FADE_FULL * FADE_FULL));
}

static uint32_t budget_ma(struct keyleds_data *d)
{
    uint32_t b = !zmk_usb_is_powered()  ? CONFIG_RYONG_LED_BUDGET_BAT_MA
                 : ryong_charger_fast() ? CONFIG_RYONG_LED_BUDGET_USB_FAST_MA
                                        : CONFIG_RYONG_LED_BUDGET_USB_MA;
    d->ug_on = false;
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    bool on = false;
    if (zmk_rgb_underglow_get_state(&on) == 0 && on) {
        d->ug_on = true;
        b = b > CONFIG_RYONG_UNDERGLOW_RESERVE_MA ? b - CONFIG_RYONG_UNDERGLOW_RESERVE_MA : 0;
    }
#endif
    return b;
}

/* On battery VCC_LED is the cell voltage (no boost): the brightest dot's peak current is capped by
 * state of charge so every LED keeps its current-sink headroom. Worst LED: LITEON top Vf bin 3.6 V at 20 mA,
 * -0.25 V x (1 - f) at lower current, sink headroom (SW 0.45 + CS 0.25 V at 31 mA) scaled to 19 mA = 0.43 f.
 * Tables from the Ver2 ngspice model (verification/spice/ledpath.py, captable.py): cell OCV(SoC) with 0.15 ohm,
 * AO3401A 0.06, BQ24075 BAT-OUT 0.08 max, TPS2553 0.135 max, traces 0.05 ohm, worst scan slot (17 LEDs) as a
 * pulse, >= 0.025 V headroom left. Plain table = min(geist table, Ver2 model).
 * Underglow table (geist-UG4, verification ug4_pi.py): SK6812MINI-HS dims by switching its LED current on and
 * off at 1 kHz (14 x 36 mA = 0.5 A for half of every millisecond at BRT_MAX 50). The underglow is fed through
 * U84 TPS2553 set to 0.31-0.40 A (R40 75k) with 5 x 330 uF polymer (C42-C46) behind it, so VDD sees at most
 * 0.40 A of nearly steady current instead of the 0.5 A pulses. Table from ug4_pi2.py at the 0.40 A limit corner
 * and +9 % LED current: >= 0.04 V headroom from 41 to 100 %. Battery only: on plain USB the key LED budget leaves
 * 100 mA for the keys while the underglow is on, so the 450 mA input limit is not crossed and VDD stays at the
 * USB level. Underglow is off at <= 40 % unless a fast charger is connected (ryong_ug_batt.c).
 * Worst-bin estimate (typical LED ~0.4 V more room). */
static const uint8_t cap_soc[] = {0, 10, 20, 30, 50, 60, 70, 80, 90, 100};
static const uint8_t cap_pct[] = {15, 23, 35, 40, 49, 54, 62, 71, 83, 99};    /* underglow off */
static const uint8_t cap_pct_ug[] = {10, 13, 17, 25, 34, 39, 46, 56, 68, 83}; /* underglow on (UG4, U84 0.40 A worst) */

static uint32_t cap_lookup(const uint8_t *pct, uint8_t soc)
{
    if (soc >= 100) {
        return pct[ARRAY_SIZE(cap_soc) - 1];
    }
    for (int i = 1; i < ARRAY_SIZE(cap_soc); i++) {
        if (soc <= cap_soc[i]) {
            return pct[i - 1] + (uint32_t)(pct[i] - pct[i - 1]) * (soc - cap_soc[i - 1]) /
                                    (cap_soc[i] - cap_soc[i - 1]);
        }
    }
    return pct[ARRAY_SIZE(cap_soc) - 1];
}

uint32_t ryong_keyleds_bat_cap_pct(uint8_t soc) { return cap_lookup(cap_pct, soc); }
uint32_t ryong_keyleds_bat_cap_pct_ug(uint8_t soc, bool underglow_on)
{
    return cap_lookup(underglow_on ? cap_pct_ug : cap_pct, soc);
}
#if IS_ENABLED(CONFIG_RYONG_LED_BAT_AUTO_CAP)
static uint32_t bat_cap_pct(const struct keyleds_data *d)
{
    return ryong_keyleds_bat_cap_pct_ug(zmk_battery_state_of_charge(), d->ug_on);
}
#endif

static int refresh(const struct device *dev)
{
    const struct keyleds_config *cfg = dev->config;
    struct keyleds_data *d = dev->data;
    uint32_t sum_sl = 0, max_sl = 0;
    int ret = 0;

    if (!d->ready) {
        return -ENODEV;
    }
    memset(d->sl, 0, sizeof(d->sl));
    for (int k = 0; k < RYONG_KEYLED_COUNT; k++) {
        uint32_t s = ((uint32_t)key_milli(d, k) * 255U + 500U) / 1000U;
        d->sl[map[k]] = (uint8_t)s;
        sum_sl += s;
        max_sl = MAX(max_sl, s);
    }
    bool any = sum_sl > 0;
    if (!any && !d->awake) {
        return 0; /* dark and in hardware shutdown: no I2C traffic */
    }
    /* average current at GCC 255 = sum_sl / 255 x DOT_FULL_UA; scale GCC into the budget */
    uint32_t full_ua = (sum_sl * DOT_FULL_UA / 255U) * cfg->gcc_full / 255U;
    uint32_t bud_ua = budget_ma(d) * 1000U;
    uint32_t gcc = cfg->gcc_full;
    if (full_ua > bud_ua) {
        gcc = (bud_ua * cfg->gcc_full) / full_ua;
    }
#if IS_ENABLED(CONFIG_RYONG_LED_BAT_AUTO_CAP)
    /* battery only (USB keeps VDD at the USB level; the underglow pulses stop at U84 + C42-C46) */
    if (!zmk_usb_is_powered()) {
        uint32_t cap_sl = (255U * bat_cap_pct(d) + 50U) / 100U; /* d->ug_on set by budget_ma() above */
        if (max_sl > cap_sl) {
            gcc = MIN(gcc, (uint32_t)cfg->gcc_full * cap_sl / max_sl);
        }
    }
#endif
    gcc = CLAMP(gcc, 1U, cfg->gcc_full);

    if (any && !d->awake) {
        uint8_t pwm[IS31FL3746A_DOTS] = {0};
        ret |= is31fl3746a_power(cfg->drv, true); /* VCC on, then VIO/SDB, then full configuration */
        for (int k = 0; k < RYONG_KEYLED_COUNT; k++) {
            pwm[map[k]] = 255;
        }
        ret |= led_write_channels(cfg->drv, 0, IS31FL3746A_DOTS, pwm);
        d->gcc_written = 0;
        d->awake = true;
        ret |= is31fl3746a_blank(cfg->drv, false);
    }
    /* order the two writes so no key flashes brighter in between */
    if (any && gcc < d->gcc_written) {
        ret |= is31fl3746a_set_gcc(cfg->drv, (uint8_t)gcc);
        ret |= is31fl3746a_write_scaling(cfg->drv, 0, IS31FL3746A_DOTS, d->sl);
    } else {
        ret |= is31fl3746a_write_scaling(cfg->drv, 0, IS31FL3746A_DOTS, d->sl);
        if (any && gcc != d->gcc_written) {
            ret |= is31fl3746a_set_gcc(cfg->drv, (uint8_t)gcc);
        }
    }
    if (any) {
        d->gcc_written = (uint8_t)gcc;
    } else {
        ret |= is31fl3746a_blank(cfg->drv, true);
        ret |= is31fl3746a_prepare_shutdown(cfg->drv);
        ret |= is31fl3746a_power(cfg->drv, false); /* VIO/SDB low, then VCC off: chip draws nothing */
        d->awake = false;
    }
    if (ret) {
        LOG_WRN("IS31FL3746A write failed (%d)", ret);
    }
    return ret;
}

static int keyleds_set_brightness(const struct device *dev, uint32_t led, uint8_t value)
{
    struct keyleds_data *d = dev->data;
    int ret;

    if (led > RYONG_KEYLED_COUNT) {
        return -EINVAL;
    }
    k_mutex_lock(&d->lock, K_FOREVER);
    if (led == 0) {
        uint8_t was = d->level;
        d->level = MIN(value, 100);
        /* Smart Backlight (geist-UG4-SB): remember the level ZMK switches off for idle (on -> off while not
         * active). A backlight the user turned off while typing stays off when hands come near, also if a
         * second 0 arrives later. */
        if (d->level) {
            d->last_on = d->level;
            d->prox_level = 0;
            d->fade_p = 0;
        } else if (zmk_activity_get_state() == ZMK_ACTIVITY_ACTIVE) {
            d->prox_level = 0;
            d->fade_p = 0;
        } else if (was) {
            /* idle off: keep showing the same level, then fade down (or stay up while hands are near) */
            d->prox_level = d->last_on;
            d->fade_p = d->away_p; /* already dark because the hands left: stay dark, no flash */
            d->away = false;
            d->away_p = FADE_FULL;
            k_work_reschedule(&fade_work, K_MSEC(FADE_STEP_MS));
        }
    } else {
        d->over[led - 1] = (int8_t)MIN(value, 100);
    }
    ret = refresh(dev);
    k_mutex_unlock(&d->lock);
    return ret;
}

int ryong_keyled_override(uint8_t key, int value)
{
    if (self == NULL || key >= RYONG_KEYLED_COUNT) {
        return -EINVAL;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    d->over[key] = value < 0 ? -1 : (int8_t)MIN(value, 100);
    int ret = refresh(self);
    k_mutex_unlock(&d->lock);
    return ret;
}

int ryong_keyled_all_off(void)
{
    if (self == NULL) {
        return -ENODEV;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    d->level = 0;
    d->prox = false;
    d->prox_level = 0;
    d->fade_p = 0;
    d->away = false;
    d->away_p = FADE_FULL;
    k_work_cancel_delayable(&fade_work);
    memset(d->over, -1, sizeof(d->over));
    int ret = refresh(self);
    k_mutex_unlock(&d->lock);
    return ret;
}

/* Smart Backlight: hands near (true) / gone after the hold time (false) */
void ryong_keyleds_prox(bool near)
{
    if (self == NULL) {
        return;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->prox != near) {
        d->prox = near;
        if (d->level == 0 && d->prox_level) {
            k_work_reschedule(&fade_work, K_NO_WAIT); /* fade toward the new target from where it is now */
        }
    }
    k_mutex_unlock(&d->lock);
}

static void fade_fn(struct k_work *w)
{
    ARG_UNUSED(w);
    if (self == NULL) {
        return;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->level) {
        uint32_t target = d->away ? 0U : FADE_FULL;
        uint32_t ms = d->away ? CONFIG_RYONG_SBL_FADE_OUT_MS : CONFIG_RYONG_SBL_FADE_IN_MS;
        uint32_t step = MAX(1U, FADE_FULL * FADE_STEP_MS / MAX(ms, 1U));
        uint32_t p = d->away_p;
        p = target > p ? MIN(p + step, target) : (p > target + step ? p - step : target);
        d->away_p = (uint16_t)p;
        refresh(self);
        if (p != target) {
            k_work_reschedule(&fade_work, K_MSEC(FADE_STEP_MS));
        }
    }
    if (d->level == 0 && d->prox_level) {
        uint32_t target = d->prox ? FADE_FULL : 0U;
        uint32_t ms = d->prox ? CONFIG_RYONG_SBL_FADE_IN_MS : CONFIG_RYONG_SBL_FADE_OUT_MS;
        uint32_t step = MAX(1U, FADE_FULL * FADE_STEP_MS / MAX(ms, 1U));
        uint32_t p = d->fade_p;
        p = target > p ? MIN(p + step, target) : (p > target + step ? p - step : target);
        d->fade_p = (uint16_t)p;
        refresh(self); /* at 0 every key is dark: refresh() cuts the LED chip's power as before */
        if (p != target) {
            k_work_reschedule(&fade_work, K_MSEC(FADE_STEP_MS));
        }
    }
    k_mutex_unlock(&d->lock);
}

/* Smart Backlight: hands gone (true) while the backlight is on -> fade to dark; false -> back.
 * instant = a key was pressed: full level at once */
void ryong_keyleds_away(bool away)
{
    if (self == NULL) {
        return;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->away != away) {
        d->away = away;
        if (d->level) {
            k_work_reschedule(&fade_work, K_NO_WAIT);
        } else if (!away) {
            d->away_p = FADE_FULL;
        }
    }
    k_mutex_unlock(&d->lock);
}

/* a key press: whatever the hands sensor said, the level is shown in full at once */
void ryong_keyleds_key(void)
{
    if (self == NULL) {
        return;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    d->away = false;
    if (d->away_p != FADE_FULL) {
        d->away_p = FADE_FULL;
        if (d->level) {
            refresh(self);
        }
    }
    k_mutex_unlock(&d->lock);
}

/* Smart Backlight: stop the LED chip's scanning for the few ms of one capacitance measurement (software
 * shutdown bit, registers kept) and start it again. Its SW lines run past the electrodes and would otherwise
 * be read as capacitance. Returns true when the chip was running, i.e. when there was something to stop. */
bool ryong_keyleds_blank(bool blank)
{
    if (self == NULL) {
        return false;
    }
    const struct keyleds_config *cfg = self->config;
    struct keyleds_data *d = self->data;
    bool was = false;
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->awake) {
        was = true;
        is31fl3746a_blank(cfg->drv, blank);
    }
    k_mutex_unlock(&d->lock);
    return was;
}

void ryong_keyleds_boost(uint8_t pct)
{
    if (self == NULL) {
        return;
    }
    const struct keyleds_config *cfg = self->config;
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->awake && d->gcc_written != 0) {
        uint32_t g = (uint32_t)d->gcc_written * (100U + pct) / 100U;
        is31fl3746a_set_gcc(cfg->drv, (uint8_t)MIN(g, (uint32_t)cfg->gcc_full));
    }
    k_mutex_unlock(&d->lock);
}

/* is there a backlight level the hands sensor could switch (on now, or switched off by ZMK for idle)? */
bool ryong_keyleds_prox_useful(void)
{
    if (self == NULL) {
        return false;
    }
    struct keyleds_data *d = self->data;
    return d->level != 0 || d->prox_level != 0;
}

bool ryong_keyleds_prox_lit(void)
{
    if (self == NULL) {
        return false;
    }
    struct keyleds_data *d = self->data;
    return d->level == 0 && d->prox && d->prox_level && d->fade_p;
}

bool ryong_keyled_is_open(uint8_t key)
{
    if (self == NULL || key >= RYONG_KEYLED_COUNT) {
        return false;
    }
    struct keyleds_data *d = self->data;
    return d->open[map[key] / 8] & BIT(map[key] % 8);
}

#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
/* underglow has no state event: re-check the budget once a second while keys are lit */
static void ug_fn(struct k_work *w);
static K_WORK_DELAYABLE_DEFINE(ug_work, ug_fn);
static void ug_fn(struct k_work *w)
{
    struct keyleds_data *d = self->data;
    bool on = false;
    zmk_rgb_underglow_get_state(&on);
    k_mutex_lock(&d->lock, K_FOREVER);
    if (d->awake && on != d->ug_on) {
        refresh(self);
    }
    k_mutex_unlock(&d->lock);
    k_work_schedule(&ug_work, K_SECONDS(1));
}
#endif

static void selftest(const struct device *dev)
{
#if IS_ENABLED(CONFIG_RYONG_KEYLED_SELFTEST)
    const struct keyleds_config *cfg = dev->config;
    struct keyleds_data *d = dev->data;
    uint8_t sl[IS31FL3746A_DOTS] = {0}, pwm[IS31FL3746A_DOTS] = {0};
    int bad = 0;

    for (int k = 0; k < RYONG_KEYLED_COUNT; k++) {
        sl[map[k]] = 0x20;
        pwm[map[k]] = 255;
    }
    /* dots must be lit for the chip to refresh their open bits: a 2 ms dim flash, not visible */
    int ret = led_write_channels(cfg->drv, 0, IS31FL3746A_DOTS, pwm);
    ret |= is31fl3746a_write_scaling(cfg->drv, 0, IS31FL3746A_DOTS, sl);
    ret |= is31fl3746a_blank(cfg->drv, false);
    ret |= is31fl3746a_detect_open(cfg->drv, d->open);
    memset(sl, 0, sizeof(sl));
    ret |= is31fl3746a_write_scaling(cfg->drv, 0, IS31FL3746A_DOTS, sl);
    if (ret) {
        LOG_WRN("LED self test failed (%d)", ret);
        memset(d->open, 0, sizeof(d->open));
        return;
    }
    for (int k = 0; k < RYONG_KEYLED_COUNT; k++) {
        if (ryong_keyled_is_open(k)) {
            LOG_WRN("key %d LED reads open (dot %d)", k, map[k]);
            bad++;
        }
    }
    LOG_INF("LED self test: %d of %d key LEDs open", bad, RYONG_KEYLED_COUNT);
#endif
}

static int keyleds_init(const struct device *dev)
{
    const struct keyleds_config *cfg = dev->config;
    struct keyleds_data *d = dev->data;
    d->away_p = FADE_FULL;

    k_mutex_init(&d->lock);
    memset(d->over, -1, sizeof(d->over));
    if (!gpio_is_ready_dt(&cfg->sdb)) {
        return -ENODEV;
    }
    self = dev;
    if (!device_is_ready(cfg->drv)) {
        LOG_ERR("IS31FL3746A not ready: key LEDs disabled");
        gpio_pin_configure_dt(&cfg->sdb, GPIO_OUTPUT_INACTIVE);
        return 0; /* keep the keyboard running; backlight calls return -ENODEV */
    }
    d->ready = true;
    selftest(dev);
    /* the driver left the chip powered; start dark: blank and SDB low (refresh with everything at 0) */
    d->awake = true;
    d->gcc_written = 0;
    refresh(dev);
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    k_work_schedule(&ug_work, K_SECONDS(1));
#endif
    return 0;
}

/* USB plugged / unplugged: re-apply the budget */
static int keyleds_usb_listener(const zmk_event_t *eh)
{
    if (self == NULL) {
        return ZMK_EV_EVENT_BUBBLE;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    refresh(self);
    k_mutex_unlock(&d->lock);
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_keyleds_usb, keyleds_usb_listener);

void ryong_keyleds_rebudget(void)
{
    if (self == NULL) {
        return;
    }
    struct keyleds_data *d = self->data;
    k_mutex_lock(&d->lock, K_FOREVER);
    refresh(self);
    k_mutex_unlock(&d->lock);
}
ZMK_SUBSCRIPTION(ryong_keyleds_usb, zmk_usb_conn_state_changed);
#if IS_ENABLED(CONFIG_RYONG_LED_BAT_AUTO_CAP)
ZMK_SUBSCRIPTION(ryong_keyleds_usb, zmk_battery_state_changed);
#endif

static DEVICE_API(led, keyleds_api) = {
    .set_brightness = keyleds_set_brightness,
};

#define KEYLEDS_DEFINE(n)                                                                          \
    static const struct keyleds_config keyleds_cfg_##n = {                                        \
        .drv = DEVICE_DT_GET(DT_INST_PHANDLE(n, driver)),                                          \
        .sdb = GPIO_DT_SPEC_INST_GET(n, sdb_gpios),                                               \
        .gcc_full = DT_PROP(DT_INST_PHANDLE(n, driver), current_limit),                            \
    };                                                                                             \
    static struct keyleds_data keyleds_data_##n;                                                   \
    DEVICE_DT_INST_DEFINE(n, keyleds_init, NULL, &keyleds_data_##n, &keyleds_cfg_##n, POST_KERNEL, \
                          KEYLEDS_INIT_PRIORITY, &keyleds_api);

DT_INST_FOREACH_STATUS_OKAY(KEYLEDS_DEFINE)
