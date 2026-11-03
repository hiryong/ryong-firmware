/* SPDX-License-Identifier: MIT */
/* Applies keyboard-side settings: light rules once a second, deep sleep after the chosen minutes.
 * All light changes run on the system workqueue (same context as ZMK's own light code). */
#include <errno.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/poweroff.h>
#include <zmk/event_manager.h>
#include <zmk/events/activity_state_changed.h>
#include <zmk/events/position_state_changed.h>
#include <zmk/events/sensor_event.h>
#include <zmk/pm.h>
#if IS_ENABLED(CONFIG_USB_DEVICE_STACK)
#include <zmk/usb.h>
#include <zmk/events/usb_conn_state_changed.h>
#endif
#if IS_ENABLED(CONFIG_ZMK_BACKLIGHT)
#include <zmk/backlight.h>
#endif
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
#include <zmk/rgb_underglow.h>
#endif
#include <zmk/ble.h>
#include <ryong/settings_runtime.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if IS_ENABLED(CONFIG_ZMK_BACKLIGHT_AUTO_OFF_USB) || IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW_AUTO_OFF_USB)
#error "Ryong runtime settings applies 'only on USB power' itself: disable ZMK's *_AUTO_OFF_USB"
#endif
#if IS_ENABLED(CONFIG_ZMK_SLEEP)
BUILD_ASSERT(CONFIG_ZMK_IDLE_SLEEP_TIMEOUT > RY_RS_SLEEP_MAX_MIN * 60000,
             "ZMK's own sleep must be longer than any runtime choice (set ZMK_IDLE_SLEEP_TIMEOUT very long)");
#endif

static K_MUTEX_DEFINE(lock);
static struct ry_settings cur;
static bool started;
static uint32_t last_activity;
struct light_track { bool wanted, forced_off; int pending; /* -1 none, 0 off, 1 on */ };
static struct light_track bl_t = {.pending = -1}, ug_t = {.pending = -1};
static bool bl_brightness_dirty, ug_brightness_dirty;

static bool usb_powered(void) {
#if IS_ENABLED(CONFIG_USB_DEVICE_STACK)
    return zmk_usb_is_powered();
#else
    return false;
#endif
}

static bool bl_is_on(void) {
#if IS_ENABLED(CONFIG_ZMK_BACKLIGHT)
    return zmk_backlight_is_on();
#else
    return false;
#endif
}
static void bl_set(bool on, uint8_t brightness) {
#if IS_ENABLED(CONFIG_ZMK_BACKLIGHT)
    if (on) zmk_backlight_set_brt(brightness ? brightness : 1);
    else if (zmk_backlight_is_on()) zmk_backlight_off();
#else
    ARG_UNUSED(on); ARG_UNUSED(brightness);
#endif
}
static bool ug_is_on(void) {
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    bool on = false;
    return zmk_rgb_underglow_get_state(&on) == 0 && on;
#else
    return false;
#endif
}
static void ug_set(bool on) {
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    if (on) zmk_rgb_underglow_on();
    else if (ug_is_on()) zmk_rgb_underglow_off();
#else
    ARG_UNUSED(on);
#endif
}
/* Keeps the underglow at or below its maximum; when the maximum was just changed on the site, the
 * underglow shows it at once (brighter too), so the slider visibly does something. */
static void ug_clamp(uint8_t max, bool changed) {
#if IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)
    if (!ug_is_on()) return;
    struct zmk_led_hsb c = zmk_rgb_underglow_calc_brt(0);
    if (c.b > max || (changed && c.b != max)) {
        c.b = max;
        zmk_rgb_underglow_set_hsb(c);
    }
#else
    ARG_UNUSED(max); ARG_UNUSED(changed);
#endif
}

static void apply_start(const struct ry_settings *s) {
    bool usb = usb_powered();
    if (IS_ENABLED(CONFIG_ZMK_BACKLIGHT)) {
        bool on = s->backlight.on_at_start && ry_light_allowed(&s->backlight, usb);
        bl_t.wanted = s->backlight.use && s->backlight.on_at_start;
        bl_t.forced_off = bl_t.wanted && !on;
        bl_set(on, s->backlight.brightness);
    }
    if (IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)) {
        bool on = s->underglow.on_at_start && ry_light_allowed(&s->underglow, usb);
        ug_t.wanted = s->underglow.use && s->underglow.on_at_start;
        ug_t.forced_off = ug_t.wanted && !on;
        ug_set(on);
    }
}

static void step_light(const struct ry_light *l, struct light_track *t, bool usb, bool (*is_on)(void), void (*set)(bool, const struct ry_light *)) {
    if (t->pending >= 0) {
        set(t->pending == 1, l);
        t->wanted = t->pending == 1;
        t->forced_off = false;
        t->pending = -1;
    }
    switch (ry_light_step(l, usb, is_on(), &t->wanted, &t->forced_off)) {
    case RY_LIGHT_FORCE_OFF: set(false, l); break;
    case RY_LIGHT_RESTORE_ON: set(true, l); break;
    default: break;
    }
}
static void bl_set_l(bool on, const struct ry_light *l) { bl_set(on, l->brightness); }
static void ug_set_l(bool on, const struct ry_light *l) { ARG_UNUSED(l); ug_set(on); }

static void tick(struct k_work *work) {
    ARG_UNUSED(work);
    struct ry_settings s;
    k_mutex_lock(&lock, K_FOREVER);
    s = cur;
    bool brt = bl_brightness_dirty, ug_brt = ug_brightness_dirty;
    bl_brightness_dirty = false;
    ug_brightness_dirty = false;
    k_mutex_unlock(&lock);
    if (!started) return;
    bool usb = usb_powered();
    if (IS_ENABLED(CONFIG_ZMK_BACKLIGHT)) {
        step_light(&s.backlight, &bl_t, usb, bl_is_on, bl_set_l);
        if (brt && bl_is_on()) bl_set(true, s.backlight.brightness);
    }
    if (IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)) {
        step_light(&s.underglow, &ug_t, usb, ug_is_on, ug_set_l);
        ug_clamp(s.underglow.brightness, ug_brt);
    }
#if IS_ENABLED(CONFIG_ZMK_SLEEP)
    if (ry_should_sleep(&s, k_uptime_get_32() - last_activity, usb)) {
        LOG_INF("Deep sleep after %u min without input", s.sleep_minutes);
        raise_zmk_activity_state_changed((struct zmk_activity_state_changed){.state = ZMK_ACTIVITY_SLEEP});
        if (zmk_pm_suspend_devices() < 0) {
            zmk_pm_resume_devices();
            last_activity = k_uptime_get_32();
            return;
        }
        sys_poweroff();
    }
#endif
}
static K_WORK_DEFINE(tick_work, tick);
static void tick_timer_fn(struct k_timer *t) { ARG_UNUSED(t); k_work_submit(&tick_work); }
static K_TIMER_DEFINE(tick_timer, tick_timer_fn, NULL);

static void start(struct k_work *work) {
    ARG_UNUSED(work);
    if (started) return;
    struct ry_settings s;
    k_mutex_lock(&lock, K_FOREVER);
    s = cur;
    k_mutex_unlock(&lock);
    apply_start(&s);
    started = true;
    k_timer_start(&tick_timer, K_SECONDS(1), K_SECONDS(1));
}
static K_WORK_DELAYABLE_DEFINE(start_work, start);

/* ---- storage ---- */
static void save(struct k_work *work) {
    ARG_UNUSED(work);
    uint8_t rec[RY_RS_RECORD_SIZE];
    k_mutex_lock(&lock, K_FOREVER);
    ry_rs_encode(&cur, rec);
    k_mutex_unlock(&lock);
    int rc = settings_save_one("ryong_rs/v1", rec, sizeof(rec));
    if (rc) LOG_ERR("Saving settings failed: %d", rc);
}
static K_WORK_DELAYABLE_DEFINE(save_work, save);

static int rs_set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg) {
    if (strcmp(name, "v1") != 0) return -ENOENT;
    uint8_t rec[RY_RS_RECORD_SIZE];
    struct ry_settings s;
    if (len != sizeof(rec) || read_cb(cb_arg, rec, sizeof(rec)) != (ssize_t)sizeof(rec) || ry_rs_decode(rec, sizeof(rec), &s)) {
        LOG_WRN("Ignoring unreadable keyboard settings; defaults kept");
        return 0;
    }
    k_mutex_lock(&lock, K_FOREVER);
    cur = s;
    k_mutex_unlock(&lock);
    return 0;
}
/* After every stored value is loaded (ZMK's lights included), apply the start rules. */
static int rs_commit(void) {
    k_work_reschedule(&start_work, K_MSEC(300));
    return 0;
}
SETTINGS_STATIC_HANDLER_DEFINE(ryong_rs, "ryong_rs", NULL, rs_set, rs_commit, NULL);

/* ---- activity for deep sleep (same inputs ZMK counts) ---- */
static int on_event(const zmk_event_t *eh) {
#if IS_ENABLED(CONFIG_USB_DEVICE_STACK)
    if (as_zmk_usb_conn_state_changed(eh)) {
        k_work_submit(&tick_work);
        return ZMK_EV_EVENT_BUBBLE;
    }
#endif
    last_activity = k_uptime_get_32();
    return ZMK_EV_EVENT_BUBBLE;
}
ZMK_LISTENER(ryong_rs, on_event);
ZMK_SUBSCRIPTION(ryong_rs, zmk_position_state_changed);
ZMK_SUBSCRIPTION(ryong_rs, zmk_sensor_event);
#if IS_ENABLED(CONFIG_USB_DEVICE_STACK)
ZMK_SUBSCRIPTION(ryong_rs, zmk_usb_conn_state_changed);
#endif

static int init(void) {
    ry_rs_defaults(&cur, CONFIG_RYONG_RUNTIME_SETTINGS_SLEEP_DEFAULT_MIN, IS_ENABLED(CONFIG_RYONG_RUNTIME_SETTINGS_LIGHTS_DEFAULT_USE));
    last_activity = k_uptime_get_32();
    /* Fallback if settings never commit (e.g. empty storage on some backends). */
    k_work_schedule(&start_work, K_SECONDS(3));
    return 0;
}
SYS_INIT(init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);

/* ---- API for the RPC ---- */
void ry_rs_get(struct ry_settings *out) {
    k_mutex_lock(&lock, K_FOREVER);
    *out = cur;
    k_mutex_unlock(&lock);
}

static void run_tick_now(void) {
    struct k_work_sync sync;
    k_work_submit(&tick_work);
    k_work_flush(&tick_work, &sync);
}

#if IS_ENABLED(CONFIG_ZMK_BLE_BACKLIGHT_INDICATOR)
/* The Bluetooth slot light (ZMK's ble_indicator.c) follows the stored settings. */
bool zmk_ble_indicator_enabled(void) {
    k_mutex_lock(&lock, K_FOREVER);
    bool use = cur.indicator.use;
    k_mutex_unlock(&lock);
    return use;
}
bool zmk_ble_indicator_shows(uint8_t signal) {
    BUILD_ASSERT(RY_RS_IND_CONNECTED == ZMK_BLE_INDICATOR_CONNECTED && RY_RS_IND_WAITING == ZMK_BLE_INDICATOR_WAITING &&
                 RY_RS_IND_PAIRING == ZMK_BLE_INDICATOR_PAIRING && RY_RS_IND_CLEARED == ZMK_BLE_INDICATOR_CLEARED);
    k_mutex_lock(&lock, K_FOREVER);
    bool shows = !(cur.indicator.hidden & signal);
    k_mutex_unlock(&lock);
    return shows;
}
uint8_t zmk_ble_indicator_brightness(void) {
    k_mutex_lock(&lock, K_FOREVER);
    uint8_t brt = cur.indicator.brightness;
    k_mutex_unlock(&lock);
    return brt;
}
#endif

int ry_rs_set(const struct ry_settings *s) {
    if (ry_rs_validate(s)) return -EINVAL;
    k_mutex_lock(&lock, K_FOREVER);
    bl_brightness_dirty = s->backlight.brightness != cur.backlight.brightness;
    ug_brightness_dirty = s->underglow.brightness != cur.underglow.brightness;
#if IS_ENABLED(CONFIG_ZMK_BLE_BACKLIGHT_INDICATOR)
    bool indicator_preview = s->indicator.use && (s->indicator.brightness != cur.indicator.brightness || !cur.indicator.use);
#endif
    cur = *s;
    k_mutex_unlock(&lock);
    k_work_reschedule(&save_work, K_SECONDS(1));
    last_activity = k_uptime_get_32();
    run_tick_now();
#if IS_ENABLED(CONFIG_ZMK_BLE_BACKLIGHT_INDICATOR)
    if (indicator_preview) zmk_ble_indicator_preview(); /* show the new brightness once */
#endif
    return 0;
}

int ry_rs_power(unsigned which, bool on) {
    struct ry_settings s;
    ry_rs_get(&s);
    const struct ry_light *l = which == RY_RS_BACKLIGHT ? &s.backlight : &s.underglow;
    if ((which == RY_RS_BACKLIGHT && !IS_ENABLED(CONFIG_ZMK_BACKLIGHT)) ||
        (which == RY_RS_UNDERGLOW && !IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW)) || which > RY_RS_UNDERGLOW)
        return -ENOTSUP;
    if (on && !ry_light_allowed(l, usb_powered())) return -EPERM;
    k_mutex_lock(&lock, K_FOREVER);
    (which == RY_RS_BACKLIGHT ? &bl_t : &ug_t)->pending = on ? 1 : 0;
    k_mutex_unlock(&lock);
    run_tick_now();
    return 0;
}

void ry_rs_live(struct ry_rs_live *out) {
    out->has_backlight = IS_ENABLED(CONFIG_ZMK_BACKLIGHT);
    out->has_underglow = IS_ENABLED(CONFIG_ZMK_RGB_UNDERGLOW);
    out->backlight_on = bl_is_on();
    out->underglow_on = ug_is_on();
    out->usb_powered = usb_powered();
}
