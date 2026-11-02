/* SPDX-License-Identifier: MIT */
#pragma once
#include <ryong/settings_core.h>

#define RY_RS_BACKLIGHT 0
#define RY_RS_UNDERGLOW 1

struct ry_rs_live {
    bool has_backlight, has_underglow;
    bool backlight_on, underglow_on;
    bool usb_powered;
};

void ry_rs_get(struct ry_settings *out);
/* Validates, applies within ~1 tick and stores (debounced) — 0 / -EINVAL / -EIO */
int ry_rs_set(const struct ry_settings *s);
/* Turn a light on/off now. -ENOTSUP if not built in, -EPERM if its rules keep it dark. */
int ry_rs_power(unsigned which, bool on);
void ry_rs_live(struct ry_rs_live *out);
