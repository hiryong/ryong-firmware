/*
 * geist geist-UG4-SB: Smart Backlight (hands near the keyboard light the key backlight).
 *
 * Hardware: TI FDC1004 (U85, I2C 0x50, same bus as MAX17048 / IS31FL3746A). Its VDD is the net SB_EN, driven
 * by an MCU pin (enable-gpios, P1.00, high drive, C49 100 nF): the chip only has a supply while a measurement
 * runs (about 10 ms), otherwise the pin is low and nothing is drawn. No regulator, no interrupt pin.
 * Electrodes (geist-UG4-S4) = the switch-side (B) copper in bands under the three bottom key rows:
 * CIN1 = left bands, CIN4 = right bands. SHLD1 drives the L3 copper under them (active shield, datasheet limit
 * 400 pF, calculated load about 220 pF). L2 / F ground is removed under the bands.
 *
 * One measurement: supply on, CONF_MEAS1/4 (single ended against CAPDAC), trigger both at 400 S/s, read the two
 * results (16 bit, 0.49 fF per count), supply off. The firmware keeps a baseline per channel and decides:
 *   near  = sum of (value - baseline) >= threshold on two samples in a row, far = below 60 % of it on two.
 * The threshold follows the sensitivity step. Once the keyboard has seen what typing hands look like on this
 * case / plate (a sample taken now and then while keys are being pressed, "span"), the threshold becomes a
 * fraction of that span, so plastic and metal cases end up with matching behaviour.
 *
 * When it measures (nothing is measured when the result could not change anything):
 *  - Smart Backlight off, backlight switched off by the user, deep sleep, soft off, suspended after faults: never
 *  - while typing (CONFIG_RYONG_SBL_KEY_PAUSE_MS after the last key): no, except one reference sample
 *    every CONFIG_RYONG_SBL_TYPING_REF_S
 *  - waiting for hands: every CONFIG_RYONG_SBL_PERIOD_MS, after CONFIG_RYONG_SBL_SLOW_AFTER_S every
 *    CONFIG_RYONG_SBL_PERIOD_SLOW_MS; lit by hands: every CONFIG_RYONG_SBL_PERIOD_LIT_MS (to see them leave)
 *
 * Behaviour (as on a Logitech MX Keys Mini): hands near -> keys fade in; hands gone for CONFIG_RYONG_SBL_HOLD_MS
 * -> fade out, also when ZMK itself would still keep the backlight on (only once the sensor has proved that it
 * sees typing hands here; otherwise ZMK's own idle timeout is all that switches off). A key press always lights
 * at once. Faults (a channel over range or shorted, no answer): that channel is ignored; with no channel left it
 * retries CONFIG_RYONG_SBL_FAIL_TRIES times and then suspends itself until USB changes, &sbl is used, or reboot.
 */
#define DT_DRV_COMPAT ryong_smart_backlight
#include <stdlib.h>
#include <string.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/byteorder.h>
#include <zmk/event_manager.h>
#include <zmk/events/usb_conn_state_changed.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/events/activity_state_changed.h>
#include <zmk/usb.h>
#include "ryong_keyleds.h"
#include "ryong_smartbl.h"
LOG_MODULE_REGISTER(ryong_sbl, CONFIG_ZMK_LOG_LEVEL);
#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)
static const struct i2c_dt_spec bus = I2C_DT_SPEC_INST_GET(0);
static const struct gpio_dt_spec en = GPIO_DT_SPEC_INST_GET_OR(0, enable_gpios, {0});
static bool bus_ok, powered, id_ok;
#define REG_MEAS_MSB(ch) ((ch) * 2)      /* ch 0..3 = MEAS1..4 */
#define REG_CONF_MEAS(ch) (0x08 + (ch))
#define REG_FDC_CONF 0x0C
#define REG_DEVICE_ID 0xFF
#define DEVICE_ID 0x1004
#define NCH 2
static const uint8_t chan[NCH] = {0, 3};  /* measurement / input index: CIN1 (left), CIN4 (right) -- geist-UG4-S4 */
#define CONF_RATE_400 0x0C00              /* RATE = b11 (400 S/s), REPEAT = 0 */
#define AF_PER_COUNT_NUM 15625            /* 1 count of the 16 bit result = 1 pF / 2048 = 488.28 aF */
#define AF_PER_COUNT_DEN 32
#define CAPDAC_AF 3125000                 /* 3.125 pF per CAPDAC step */
#define CAPDAC_MAX 31
#define RAIL_COUNTS 0x6800                /* beyond +/-13 pF of the +/-16 pF range: not usable */
#define SAT_COUNTS 0x7400                 /* 14.5 pF: at the edge of the +/-15 pF conversion range, treated as clipped */
#define CENTER_COUNTS 0x1000              /* more than 2 pF off centre: move CAPDAC (3.125 pF steps) */
/* fixed thresholds in fF per sensitivity step (1 = least sensitive), used until a typing span is known,
 * and the share of the span used afterwards (percent) */
static const uint8_t thresh_ff[] = {48, 36, 27, 20, 15, 11, 8};
static const uint8_t span_pct[] = {60, 50, 42, 35, 28, 22, 16};
#define SENS_STEPS ARRAY_SIZE(thresh_ff)
#define THR_MIN_AF 5000
#define THR_MAX_AF 80000
static bool enabled = IS_ENABLED(CONFIG_RYONG_SBL_DEFAULT_ON), near;
static uint8_t sens = CONFIG_RYONG_SBL_DEFAULT_SENS; /* 1..SENS_STEPS */
static uint8_t capdac[NCH];
static bool ch_ok[NCH], base_ok[NCH];
static uint8_t settle[NCH];
static int32_t val[NCH], base[NCH];       /* aF */
static int32_t delta, prev_delta, noise;  /* aF */
static uint8_t on_cnt, off_cnt, neg_cnt, range_cnt;
static int64_t near_since, last_key = -100000, far_since, last_ref = -100000, last_event;
static bool hold_done, fault, suspended;
static uint8_t fail_tries;
static int32_t span_buf[5], span;         /* typing reference: median of the last samples, aF */
static int32_t span_saved;                /* the span kept in settings, so a restart does not start from the fixed table */
static uint8_t span_n;
/* a measurement sleeps while the chip converts; switching off, USB events and sleep come from other threads */
static K_MUTEX_DEFINE(sbl_lock);
static void tick_locked(void);
static void ref_locked(void);
static void tick_fn(struct k_work *w)
{
    ARG_UNUSED(w);
    k_mutex_lock(&sbl_lock, K_FOREVER);
    tick_locked();
    k_mutex_unlock(&sbl_lock);
}
static void ref_fn(struct k_work *w)
{
    ARG_UNUSED(w);
    k_mutex_lock(&sbl_lock, K_FOREVER);
    ref_locked();
    k_mutex_unlock(&sbl_lock);
}
static K_WORK_DELAYABLE_DEFINE(tick_work, tick_fn);
static K_WORK_DELAYABLE_DEFINE(ref_work, ref_fn);
static void save_fn(struct k_work *w);
static K_WORK_DELAYABLE_DEFINE(save_work, save_fn);
/* RYONG_SBL_BATTERY_ONLY: with USB power the backlight is a plain backlight (no measurement, no learning) */
static bool wired(void) { return IS_ENABLED(CONFIG_RYONG_SBL_BATTERY_ONLY) && zmk_usb_is_powered(); }
static int wr16(uint8_t reg, uint16_t v)
{
    uint8_t b[2];
    sys_put_be16(v, b);
    return i2c_burst_write_dt(&bus, reg, b, 2);
}
static int rd16(uint8_t reg, uint16_t *v)
{
    uint8_t b[2];
    int ret = i2c_burst_read_dt(&bus, reg, b, 2);
    *v = sys_get_be16(b);
    return ret;
}
static void power(bool on)
{
    if (en.port == NULL) {
        powered = true;
        return;
    }
    if (on && !powered) {
        gpio_pin_set_dt(&en, 1);
        k_msleep(CONFIG_RYONG_SBL_POWER_ON_MS);
        powered = true;
    } else if (!on && powered && !IS_ENABLED(CONFIG_RYONG_SBL_ALWAYS_POWERED)) {
        gpio_pin_set_dt(&en, 0);
        powered = false;
    }
}
/* one measurement of both channels. 0 = at least one channel gave a value */
static int measure(void)
{
    uint16_t v;
    int ret = 0;
    power(true);
    if (!id_ok) {
        if (rd16(REG_DEVICE_ID, &v) != 0 || v != DEVICE_ID) {
            LOG_WRN("smart backlight sensor id 0x%04x (want 0x%04x)", v, DEVICE_ID);
            power(false);
            return -ENODEV;
        }
        id_ok = true;
    }
    int good = 0;
    bool ranging = false;
    /* While the key LEDs are lit, the LED chip is stopped for the conversion and only one channel is taken per
     * call, left and right in turn, so the dark gap stays short: the chip runs again as soon as DONE is seen.
     * RYONG_SBL_BLANK=n (experiment): the chip keeps scanning and several conversions are averaged instead. */
    bool lit = ryong_keyleds_blank(false);
    bool blank = lit && IS_ENABLED(CONFIG_RYONG_SBL_BLANK);
    int nrep = (lit && !blank) ? CONFIG_RYONG_SBL_NOBLANK_AVG : 1;
    static uint8_t turn;
    turn ^= 1;
    for (int i = 0; ret == 0 && i < NCH; i++) {
        uint16_t msb = 0, lsb;
        int32_t acc = 0;
        if (blank && i != turn && ch_ok[i] && base_ok[i]) {
            good++; /* keeps its last value this time */
            continue;
        }
        /* CHA = CINn, CHB = CAPDAC (b100), CAPDAC value. Single shot (REPEAT = 0) takes one measurement per
         * trigger (datasheet 7.4), so the two channels are triggered one after the other. */
        ret = wr16(REG_CONF_MEAS(chan[i]), (uint16_t)(chan[i] << 13) | (4U << 10) | ((uint16_t)capdac[i] << 5));
        if (ret != 0) {
            break;
        }
        if (blank && IS_ENABLED(CONFIG_RYONG_SBL_COMP)) {
            ryong_keyleds_boost(CONFIG_RYONG_SBL_COMP_PCT);
            k_msleep(CONFIG_RYONG_SBL_COMP_MS);
        }
        for (int rep = 0; ret == 0 && rep < nrep; rep++) {
            if (blank) {
                ryong_keyleds_blank(true);
            }
            ret = wr16(REG_FDC_CONF, CONF_RATE_400 | BIT(7 - chan[i]));
            if (ret == 0) {
                k_usleep(CONFIG_RYONG_SBL_CONV_US);
                for (int t = 0;; t++) {
                    if (rd16(REG_FDC_CONF, &v) == 0 && (v & BIT(3 - chan[i]))) {
                        break;
                    }
                    if (t == 30) {
                        ret = -ETIMEDOUT;
                        break;
                    }
                    k_usleep(300);
                }
            }
            if (blank) {
                ryong_keyleds_blank(false);
            }
            /* both result registers are read, lower address first: only then is the measurement "read" (DONE clears) */
            if (ret != 0 || rd16(REG_MEAS_MSB(chan[i]), &msb) != 0 || rd16(REG_MEAS_MSB(chan[i]) + 1, &lsb) != 0) {
                ret = ret ? ret : -EIO;
                break;
            }
            acc += (int16_t)msb;
        }
        if (blank && IS_ENABLED(CONFIG_RYONG_SBL_COMP)) {
            k_msleep(CONFIG_RYONG_SBL_COMP_MS);
            ryong_keyleds_boost(0);
        }
        if (ret != 0) {
            break;
        }
        msb = (uint16_t)(int16_t)(acc / nrep);
        int16_t c = (int16_t)msb; /* upper 16 of the 24 bit result: 1 count = 1 pF / 2048 */
        ARG_UNUSED(lsb);
        int32_t abs_af = (int32_t)c * AF_PER_COUNT_NUM / AF_PER_COUNT_DEN + (int32_t)capdac[i] * CAPDAC_AF;
        int want = CLAMP((abs_af + CAPDAC_AF / 2) / CAPDAC_AF, 0, CAPDAC_MAX);
        if (c >= SAT_COUNTS) {
            want = MIN(capdac[i] + 5, CAPDAC_MAX); /* clipped: the real value is further away than it reads */
        } else if (c <= -SAT_COUNTS) {
            want = MAX(capdac[i] - 5, 0);
        }
        if (abs(c) > CENTER_COUNTS && want != capdac[i]) {
            /* move the CAPDAC window onto the electrode and measure again */
            capdac[i] = (uint8_t)want;
            base_ok[i] = false;
            settle[i] = 0;
            ranging = true;
            continue;
        }
        if (abs(c) > RAIL_COUNTS) {
            /* at the end of CAPDAC and still outside: the electrode is too large or shorted to GND */
            if (ch_ok[i]) {
                LOG_WRN("smart backlight: channel %d out of range (electrode on GND or too large)", i);
            }
            ch_ok[i] = false;
            base_ok[i] = false;
            settle[i] = 0;
            continue;
        }
        ch_ok[i] = true;
        val[i] = (int32_t)c * AF_PER_COUNT_NUM / AF_PER_COUNT_DEN + (int32_t)capdac[i] * CAPDAC_AF;
        good++;
    }
    if (!IS_ENABLED(CONFIG_RYONG_SBL_KEEP_POWERED) || ret) {
        power(false);
    }
    if (ret) {
        id_ok = false;
        return ret;
    }
    if (ranging) {
        return -EAGAIN;
    }
    return good ? 0 : -ERANGE;
}
static int32_t threshold(void)
{
    int32_t t = (int32_t)thresh_ff[sens - 1] * 1000;
    if (span_n >= 3) {
        t = span / 100 * span_pct[sens - 1];
    }
    t = MAX(t, noise * 4); /* never inside the noise seen while nothing is near */
    return CLAMP(t, THR_MIN_AF, THR_MAX_AF);
}
/* typing hands hardly change the reading (a grounded metal plate between the electrodes and the hands does that):
 * the sensor cannot help on this build. It is then left off; the typing reference keeps checking, so it comes
 * switched off completely (no measurement at all) until USB changes, &sbl is used, or the next start, where it
 * learns again from scratch. */
#define BLIND_AF 6000
static bool blind_on;
static bool blind(void) { return blind_on; }
/* the sensor has shown that it sees typing hands on this case: it may also switch the light off early */
static bool trusted(void) { return span_n >= 3 && span >= threshold() * 3 / 2; }
static void rebaseline(void)
{
    for (int i = 0; i < NCH; i++) {
        base_ok[i] = false;
        settle[i] = 0;
    }
    on_cnt = off_cnt = neg_cnt = 0;
}
static void set_near(bool on, int64_t now)
{
    if (near == on) {
        return;
    }
    near = on;
    if (on) {
        near_since = now;
    } else {
        far_since = now;
        hold_done = false;
    }
    last_event = now;
    LOG_DBG("smart backlight: %s (%d aF, threshold %d)", on ? "near" : "far", delta, threshold());
}
static void lights_idle(void)
{
    ryong_keyleds_prox(false);
    ryong_keyleds_away(false);
}
static void stop(void)
{
    k_work_cancel_delayable(&tick_work);
    k_work_cancel_delayable(&ref_work);
    power(false);
    near = false;
    hold_done = true;
    lights_idle();
}
static void apply(void)
{
    k_mutex_lock(&sbl_lock, K_FOREVER);
    stop();
    fault = false;
    if (blind_on) { /* asked to try again: learn from scratch */
        blind_on = false;
        span_n = 0;
        span_saved = 0;
    }
    if (!bus_ok || !enabled || suspended || wired()) {
        k_mutex_unlock(&sbl_lock);
        return;
    }
    rebaseline();
    k_work_schedule(&tick_work, K_MSEC(CONFIG_RYONG_SBL_PERIOD_MS));
    k_mutex_unlock(&sbl_lock);
}
/* sum of the channel deltas; false while a baseline is still being taken */
static bool update(bool track)
{
    bool ready = false;
    int32_t d = 0;
    for (int i = 0; i < NCH; i++) {
        if (!ch_ok[i]) {
            continue;
        }
        if (!base_ok[i]) {
            base[i] = settle[i] == 0 ? val[i] : (base[i] + val[i]) / 2;
            if (++settle[i] >= 3) {
                base_ok[i] = true;
            }
            continue;
        }
        ready = true;
        d += val[i] - base[i];
    }
    if (!ready) {
        return false;
    }
    prev_delta = delta;
    delta = d;
    if (track) {
        int32_t thr = threshold();
        if (abs(d) < thr / 2) {
            for (int i = 0; i < NCH; i++) {
                if (ch_ok[i] && base_ok[i]) {
                    base[i] += (val[i] - base[i]) / 8;
                }
            }
            noise += (abs(d - prev_delta) - noise) / 8;
        }
    }
    return true;
}
static void failed(int64_t now)
{
    fault = true;
    set_near(false, now);
    hold_done = true;
    lights_idle();
    if (++fail_tries >= CONFIG_RYONG_SBL_FAIL_TRIES) {
        LOG_WRN("smart backlight: %d measurements failed, suspended until USB changes or &sbl", fail_tries);
        suspended = true;
        stop();
        return;
    }
    k_work_schedule(&tick_work, K_SECONDS(CONFIG_RYONG_SBL_FAIL_RETRY_S));
}
static void tick_locked(void)
{
    int64_t now = k_uptime_get();
    if (!enabled || suspended || !bus_ok || wired()) {
        return;
    }
    if (now - last_key < CONFIG_RYONG_SBL_KEY_PAUSE_MS) { /* typing: the keys themselves keep the light on */
        k_work_schedule(&tick_work, K_MSEC(CONFIG_RYONG_SBL_KEY_PAUSE_MS - (now - last_key)));
        return;
    }
    if (blind_on) {
        return;
    }
    if (!ryong_keyleds_prox_useful()) { /* backlight switched off by the user: nothing to light */
        set_near(false, now);
        k_work_schedule(&tick_work, K_SECONDS(2));
        return;
    }
    int mret = measure();
    if (mret == -EAGAIN && ++range_cnt <= 16) { /* CAPDAC moved: measure again right away */
        k_work_schedule(&tick_work, K_MSEC(20));
        return;
    }
    range_cnt = 0;
    if (mret != 0) {
        failed(now);
        return;
    }
    if (fault) {
        LOG_INF("smart backlight: measuring again");
    }
    fault = false;
    fail_tries = 0;
    if (!update(!near)) {
        k_work_schedule(&tick_work, K_MSEC(40)); /* taking a baseline */
        return;
    }
    int32_t thr = threshold();
    bool quick = false;
    if (!near) {
        if (delta >= thr) {
            if (++on_cnt >= CONFIG_RYONG_SBL_NEAR_COUNT) {
                set_near(true, now);
                on_cnt = 0;
            } else {
                quick = true; /* confirm at once instead of waiting a whole period */
            }
        } else {
            on_cnt = 0;
        }
        if (delta <= -thr / 2) { /* something that was there at baseline time went away */
            if (++neg_cnt >= 4) {
                rebaseline();
            }
        } else {
            neg_cnt = 0;
        }
    } else {
        if (delta <= thr * 6 / 10) {
            if (++off_cnt >= CONFIG_RYONG_SBL_FAR_COUNT) {
                set_near(false, now);
                off_cnt = 0;
            } else {
                quick = IS_ENABLED(CONFIG_RYONG_SBL_FAR_QUICK);
            }
        } else {
            off_cnt = 0;
        }
        if (near && now - near_since > CONFIG_RYONG_SBL_STUCK_S * 1000LL && last_key < near_since) {
            LOG_INF("smart backlight: near for %d s without typing, new baseline", CONFIG_RYONG_SBL_STUCK_S);
            set_near(false, now);
            rebaseline();
        }
    }
    if (near) {
        ryong_keyleds_away(false);
        ryong_keyleds_prox(true);
    } else if (!hold_done && on_cnt == 0 && now - far_since >= CONFIG_RYONG_SBL_HOLD_MS) {
        hold_done = true;
        ryong_keyleds_prox(false);
        if (trusted()) {
            ryong_keyleds_away(true); /* hands gone: dark now, not only at ZMK's idle timeout */
        }
    }
    uint32_t ms;
    if (quick) {
        ms = 40;
    } else if (near || !hold_done) {
        ms = CONFIG_RYONG_SBL_PERIOD_LIT_MS;
    } else if (now - MAX(last_key, last_event) < CONFIG_RYONG_SBL_SLOW_AFTER_S * 1000LL) {
        ms = CONFIG_RYONG_SBL_PERIOD_MS;
    } else {
        ms = CONFIG_RYONG_SBL_PERIOD_SLOW_MS;
    }
    k_work_schedule(&tick_work, K_MSEC(ms));
}
static int cmp32(const void *a, const void *b) { return (*(const int32_t *)a > *(const int32_t *)b) - (*(const int32_t *)a < *(const int32_t *)b); }
/* reference sample while keys are being pressed: this is what "hands on the keyboard" reads on this case */
static void ref_locked(void)
{
    int64_t now = k_uptime_get();
    if (!enabled || suspended || blind_on || !bus_ok || wired() || now - last_key > 1500 || !ryong_keyleds_prox_useful()) {
        return;
    }
    last_ref = now;
    if (measure() != 0 || !update(false)) {
        return;
    }
    if (delta < 0) {
        return; /* the baseline was taken with the hands already there: tick_fn sorts that out */
    }
    span_buf[span_n % ARRAY_SIZE(span_buf)] = delta;
    span_n = MIN(span_n + 1, 200);
    int n = MIN(span_n, ARRAY_SIZE(span_buf));
    int32_t tmp[ARRAY_SIZE(span_buf)];
    memcpy(tmp, span_buf, sizeof(tmp));
    qsort(tmp, n, sizeof(int32_t), cmp32);
    span = tmp[n / 2];
    if (span_n >= ARRAY_SIZE(span_buf) && span < BLIND_AF) {
        LOG_WRN("smart backlight: typing hands read only %d aF here (grounded metal plate?), switched off", span);
        blind_on = true;
        stop();
        return;
    }
    if (span_n >= 3 && span >= BLIND_AF && abs(span - span_saved) > span_saved / 5) {
        span_saved = span;
        k_work_reschedule(&save_work, K_SECONDS(60));
    }
    LOG_DBG("smart backlight: typing reference %d aF, span %d aF", delta, span);
}
int ryong_sbl_set(int cmd)
{
    switch (cmd) {
    case RYONG_SBL_TOG:
        enabled = !enabled;
        break;
    case RYONG_SBL_ON:
        enabled = true;
        break;
    case RYONG_SBL_OFF:
        enabled = false;
        break;
    case RYONG_SBL_UP:
        sens = MIN(sens + 1, SENS_STEPS);
        break;
    case RYONG_SBL_DN:
        sens = MAX(sens - 1, 1);
        break;
    default:
        return -EINVAL;
    }
    LOG_INF("smart backlight %s, sensitivity %d/%d", enabled ? "on" : "off", sens, SENS_STEPS);
    suspended = false;
    fail_tries = 0;
    apply();
    k_work_reschedule(&save_work, K_MSEC(CONFIG_ZMK_SETTINGS_SAVE_DEBOUNCE));
    return 0;
}

bool ryong_sbl_enabled(void) { return enabled; }
uint8_t ryong_sbl_sensitivity(void) { return sens; }
bool ryong_sbl_near(void) { return near; }
bool ryong_sbl_fault(void) { return fault || suspended; }
int32_t ryong_sbl_delta_af(void) { return delta; }
int32_t ryong_sbl_span_af(void) { return span_n >= 3 ? span : 0; }
int32_t ryong_sbl_threshold_af(void) { return threshold(); }
bool ryong_sbl_suspended(void) { return suspended; }
bool ryong_sbl_blind(void) { return blind(); }

void ryong_sbl_sleep(void)
{
    k_mutex_lock(&sbl_lock, K_FOREVER);
    stop(); /* supply pin low: nothing drawn while the keyboard sleeps or is off */
    k_mutex_unlock(&sbl_lock);
}
static void save_fn(struct k_work *w)
{
#if IS_ENABLED(CONFIG_SETTINGS)
    uint8_t v[2] = {enabled, sens};
    settings_save_one("ryong_sbl/state", v, sizeof(v));
    if (span_saved > 0) {
        settings_save_one("ryong_sbl/span", &span_saved, sizeof(span_saved));
    }
#endif
}

#if IS_ENABLED(CONFIG_SETTINGS)
static int sbl_set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg)
{
    const char *next;
    if (settings_name_steq(name, "state", &next) && !next && len == 2) {
        uint8_t v[2];
        if (read_cb(cb_arg, v, 2) == 2) {
            enabled = v[0] != 0;
            sens = CLAMP(v[1], 1, SENS_STEPS);
            apply();
        }
        return 0;
    }
    if (settings_name_steq(name, "span", &next) && !next && len == sizeof(span_saved)) {
        int32_t v;
        if (read_cb(cb_arg, &v, sizeof(v)) == sizeof(v) && v > 0 && v < 5000000) {
            span_saved = span = v;
            for (int i = 0; i < ARRAY_SIZE(span_buf); i++) {
                span_buf[i] = v;
            }
            span_n = ARRAY_SIZE(span_buf);
        }
        return 0;
    }
    return -ENOENT;
}
SETTINGS_STATIC_HANDLER_DEFINE(ryong_sbl, "ryong_sbl", NULL, sbl_set, NULL, NULL);
#endif

static int sbl_init(void)
{
    if (!i2c_is_ready_dt(&bus)) {
        return 0;
    }
    if (en.port != NULL) {
        if (!gpio_is_ready_dt(&en) ||
            gpio_pin_configure_dt(&en, IS_ENABLED(CONFIG_RYONG_SBL_ALWAYS_POWERED) ? GPIO_OUTPUT_ACTIVE : GPIO_OUTPUT_INACTIVE) != 0) {
            LOG_WRN("smart backlight enable pin not ready: feature off");
            return 0;
        }
        powered = IS_ENABLED(CONFIG_RYONG_SBL_ALWAYS_POWERED);
    } else {
        powered = true;
    }
    bus_ok = true;
    apply();
    return 0;
}
/* after the I2C bus and the key LEDs, before settings are loaded (settings then call apply() again) */
SYS_INIT(sbl_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

static int sbl_listener(const zmk_event_t *eh)
{
    if (as_zmk_position_state_changed(eh) != NULL) {
        int64_t now = k_uptime_get();
        last_key = now;
        if (enabled && !suspended && !blind_on && bus_ok && !wired()) {
            ryong_keyleds_key(); /* a key always lights at once */
            far_since = now; /* if the hands are gone when measuring resumes, the hold counts from this key */
            hold_done = false;
            k_work_reschedule(&tick_work, K_MSEC(CONFIG_RYONG_SBL_KEY_PAUSE_MS));
            if (now - last_ref >= CONFIG_RYONG_SBL_TYPING_REF_S * 1000LL) {
                last_ref = now;
                k_work_reschedule(&ref_work, K_MSEC(300));
            }
        }
        return ZMK_EV_EVENT_BUBBLE;
    }
    if (as_zmk_usb_conn_state_changed(eh) != NULL) {
        /* the board's ground reference changes with the cable; it is also the usual cause of a fault */
        suspended = false;
        fail_tries = 0;
        apply();
        return ZMK_EV_EVENT_BUBBLE;
    }
    const struct zmk_activity_state_changed *a = as_zmk_activity_state_changed(eh);
    if (a != NULL && a->state == ZMK_ACTIVITY_SLEEP) {
        ryong_sbl_sleep();
    }
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_sbl, sbl_listener);
ZMK_SUBSCRIPTION(ryong_sbl, zmk_position_state_changed);
ZMK_SUBSCRIPTION(ryong_sbl, zmk_usb_conn_state_changed);
ZMK_SUBSCRIPTION(ryong_sbl, zmk_activity_state_changed);

#else
void ryong_sbl_sleep(void) {}
#endif
