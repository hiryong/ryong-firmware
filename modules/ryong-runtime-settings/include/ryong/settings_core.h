/* SPDX-License-Identifier: MIT */
/* Pure logic for keyboard-side settings: no Zephyr, unit-tested on the host. */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RY_RS_VERSION 1
#define RY_RS_SLEEP_MAX_MIN 1440
#define RY_RS_RECORD_SIZE 12
#define RY_RS_INDICATOR_BRT_DEFAULT 1

struct ry_light {
    bool use;
    bool on_at_start;
    uint8_t brightness; /* 0-100 */
    bool usb_only;
};

/* Bluetooth slot light on the backlight (blink while pairing, flash when a slot is cleared). */
struct ry_indicator {
    bool use;
    uint8_t brightness; /* 1-100 */
};

struct ry_settings {
    bool sleep_enabled;
    uint16_t sleep_minutes; /* 1-1440 */
    struct ry_light backlight;
    struct ry_light underglow;
    struct ry_indicator indicator;
};

void ry_rs_defaults(struct ry_settings *s, uint16_t sleep_default_min, bool lights_use);
/* 0 or -EINVAL; never modifies anything. */
int ry_rs_validate(const struct ry_settings *s);
/* Fixed little record with a version byte and checksum; returns bytes written. */
size_t ry_rs_encode(const struct ry_settings *s, uint8_t out[RY_RS_RECORD_SIZE]);
/* 0 on success; -EINVAL on wrong size/version/checksum/values (caller keeps defaults). */
int ry_rs_decode(const uint8_t *in, size_t len, struct ry_settings *s);

/* May this light be lit right now? */
static inline bool ry_light_allowed(const struct ry_light *l, bool usb_powered) {
    return l->use && (!l->usb_only || usb_powered);
}

/* What a light should do on a tick.  `wanted` is the person's intent (kept while forced dark). */
enum ry_light_action { RY_LIGHT_KEEP, RY_LIGHT_FORCE_OFF, RY_LIGHT_RESTORE_ON };
enum ry_light_action ry_light_step(const struct ry_light *l, bool usb_powered, bool is_on, bool *wanted, bool *forced_off);

/* Deep sleep: enabled, long enough without input, and not on USB power (same as ZMK). */
static inline bool ry_should_sleep(const struct ry_settings *s, uint32_t inactive_ms, bool usb_powered) {
    return s->sleep_enabled && !usb_powered && inactive_ms >= (uint32_t)s->sleep_minutes * 60000u;
}
