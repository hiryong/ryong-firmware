/* SPDX-License-Identifier: MIT */
#include <errno.h>
#include <string.h>
#include <ryong/settings_core.h>

void ry_rs_defaults(struct ry_settings *s, uint16_t sleep_default_min, bool lights_use) {
    memset(s, 0, sizeof(*s));
    s->sleep_enabled = sleep_default_min > 0;
    s->sleep_minutes = sleep_default_min > 0 ? sleep_default_min : 15;
    s->backlight = (struct ry_light){.use = lights_use, .on_at_start = true, .brightness = 40, .usb_only = false};
    s->underglow = (struct ry_light){.use = lights_use, .on_at_start = true, .brightness = 50, .usb_only = true};
}

static bool light_ok(const struct ry_light *l) { return l->brightness <= 100; }

int ry_rs_validate(const struct ry_settings *s) {
    if (!s || s->sleep_minutes < 1 || s->sleep_minutes > RY_RS_SLEEP_MAX_MIN) return -EINVAL;
    if (!light_ok(&s->backlight) || !light_ok(&s->underglow)) return -EINVAL;
    return 0;
}

static uint8_t flags(const struct ry_light *l) {
    return (uint8_t)((l->use ? 1 : 0) | (l->on_at_start ? 2 : 0) | (l->usb_only ? 4 : 0));
}
static void unflags(struct ry_light *l, uint8_t f, uint8_t brt) {
    l->use = f & 1;
    l->on_at_start = f & 2;
    l->usb_only = f & 4;
    l->brightness = brt;
}
static uint8_t sum(const uint8_t *b, size_t n) {
    uint8_t x = 0xA5;
    for (size_t i = 0; i < n; i++) x = (uint8_t)((x << 1 | x >> 7) ^ b[i]);
    return x;
}

/* [ver][sleep_on][min lo][min hi][bl flags][bl brt][ug flags][ug brt][0][0][0][sum] */
size_t ry_rs_encode(const struct ry_settings *s, uint8_t out[RY_RS_RECORD_SIZE]) {
    memset(out, 0, RY_RS_RECORD_SIZE);
    out[0] = RY_RS_VERSION;
    out[1] = s->sleep_enabled ? 1 : 0;
    out[2] = (uint8_t)(s->sleep_minutes & 0xff);
    out[3] = (uint8_t)(s->sleep_minutes >> 8);
    out[4] = flags(&s->backlight);
    out[5] = s->backlight.brightness;
    out[6] = flags(&s->underglow);
    out[7] = s->underglow.brightness;
    out[RY_RS_RECORD_SIZE - 1] = sum(out, RY_RS_RECORD_SIZE - 1);
    return RY_RS_RECORD_SIZE;
}

int ry_rs_decode(const uint8_t *in, size_t len, struct ry_settings *s) {
    if (!in || len != RY_RS_RECORD_SIZE || in[0] != RY_RS_VERSION) return -EINVAL;
    if (sum(in, RY_RS_RECORD_SIZE - 1) != in[RY_RS_RECORD_SIZE - 1]) return -EINVAL;
    if (in[1] > 1 || (in[4] & ~7) || (in[6] & ~7)) return -EINVAL;
    struct ry_settings t;
    memset(&t, 0, sizeof(t));
    t.sleep_enabled = in[1];
    t.sleep_minutes = (uint16_t)(in[2] | in[3] << 8);
    unflags(&t.backlight, in[4], in[5]);
    unflags(&t.underglow, in[6], in[7]);
    if (ry_rs_validate(&t)) return -EINVAL;
    *s = t;
    return 0;
}

enum ry_light_action ry_light_step(const struct ry_light *l, bool usb_powered, bool is_on, bool *wanted, bool *forced_off) {
    if (!ry_light_allowed(l, usb_powered)) {
        if (is_on) {
            /* Remember the person wanted it lit only when USB-only rules forced it dark;
             * a disabled feature forgets the wish. */
            *wanted = l->use;
            *forced_off = true;
            return RY_LIGHT_FORCE_OFF;
        }
        if (!l->use) *wanted = false;
        return RY_LIGHT_KEEP;
    }
    if (*forced_off) {
        *forced_off = false;
        if (*wanted && !is_on) return RY_LIGHT_RESTORE_ON;
    }
    *wanted = is_on;
    return RY_LIGHT_KEEP;
}
