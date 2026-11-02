/*
 * Copyright (c) 2026 qtrnmr
 * SPDX-License-Identifier: MIT
 *
 * NVS-backed store for runtime hold-tap timing. Each behavior instance
 * registers its live timing struct + devicetree defaults; saved values load
 * from NVS at boot and are applied to the live struct. Writes are NVS-first.
 */

#include <errno.h>
#include <string.h>
#include <stdlib.h>

#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/printk.h>
#include <zephyr/logging/log.h>

#include <zmk/runtime_holdtap.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define SLOTS CONFIG_ZMK_RUNTIME_HOLDTAP_SLOTS
#define SETTINGS_PREFIX "rt_holdtap"

static struct slot_state {
    struct rt_holdtap_timing *live; // registered live struct (data->t), or NULL
    struct rt_holdtap_timing dt_default;
    struct rt_holdtap_timing saved;
    const char *behavior_name; // dev->name of the registering behavior, or NULL
    bool has_saved;
    bool registered;
} slots[SLOTS];

K_MUTEX_DEFINE(rt_holdtap_lock);

static bool valid_timing(const struct rt_holdtap_timing *t) {
    return t && t->tapping_term_ms >= 1 && t->tapping_term_ms <= 2000 &&
        t->quick_tap_ms >= -1 && t->quick_tap_ms <= 2000 &&
        t->require_prior_idle_ms >= -1 && t->require_prior_idle_ms <= 2000 && t->flavor <= 3;
}

// settings "set" callback: invoked for each stored key during settings_load.
static int rt_holdtap_settings_set(const char *name, size_t len, settings_read_cb read_cb,
                                   void *cb_arg) {
    char *endptr;
    long slot = strtol(name, &endptr, 10);
    if (*endptr != '\0' || slot < 0 || slot >= SLOTS) {
        return -ENOENT;
    }
    struct rt_holdtap_timing t;
    if (len != sizeof(t)) {
        return -EINVAL;
    }
    int rc = read_cb(cb_arg, &t, sizeof(t));
    if (rc != sizeof(t) || !valid_timing(&t)) {
        return -EINVAL;
    }
    k_mutex_lock(&rt_holdtap_lock, K_FOREVER);
    slots[slot].saved = t;
    slots[slot].has_saved = true;
    if (slots[slot].registered && slots[slot].live) {
        *slots[slot].live = t;
    }
    k_mutex_unlock(&rt_holdtap_lock);
    return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(rt_holdtap, SETTINGS_PREFIX, NULL, rt_holdtap_settings_set, NULL,
                               NULL);

int rt_holdtap_register(uint8_t slot, struct rt_holdtap_timing *live,
                         const struct rt_holdtap_timing *dt_default,
                         const char *behavior_name) {
    if (slot >= SLOTS || live == NULL || !valid_timing(dt_default)) {
        return -EINVAL;
    }
    k_mutex_lock(&rt_holdtap_lock, K_FOREVER);
    if (slots[slot].registered && slots[slot].live != live) {
        k_mutex_unlock(&rt_holdtap_lock);
        return -EEXIST;
    }
    slots[slot].live = live;
    slots[slot].dt_default = *dt_default;
    slots[slot].behavior_name = behavior_name;
    slots[slot].registered = true;
    if (slots[slot].has_saved) {
        *live = slots[slot].saved; // apply a value already loaded from NVS
    }
    k_mutex_unlock(&rt_holdtap_lock);
    return 0;
}

int rt_holdtap_get(uint8_t slot, struct rt_holdtap_timing *out) {
    if (slot >= SLOTS) {
        return -EINVAL;
    }
    k_mutex_lock(&rt_holdtap_lock, K_FOREVER);
    int rc = slots[slot].registered ? 0 : -ENOENT;
    if (rc == 0 && out) {
        *out = *slots[slot].live;
    }
    k_mutex_unlock(&rt_holdtap_lock);
    return rc;
}

int rt_holdtap_set(uint8_t slot, const struct rt_holdtap_timing *in) {
    if (slot >= SLOTS || !valid_timing(in) || !slots[slot].registered) {
        return -EINVAL;
    }
    char key[32];
    snprintk(key, sizeof(key), SETTINGS_PREFIX "/%u", slot);
    int rc = settings_save_one(key, in, sizeof(*in)); // NVS-first
    if (rc) {
        LOG_ERR("rt_holdtap: settings_save_one(%s) failed: %d", key, rc);
        return rc;
    }
    k_mutex_lock(&rt_holdtap_lock, K_FOREVER);
    slots[slot].saved = *in;
    slots[slot].has_saved = true;
    if (slots[slot].registered && slots[slot].live) {
        *slots[slot].live = *in;
    }
    k_mutex_unlock(&rt_holdtap_lock);
    return 0;
}

int rt_holdtap_reset(uint8_t slot) {
    if (slot >= SLOTS) {
        return -EINVAL;
    }
    char key[32];
    snprintk(key, sizeof(key), SETTINGS_PREFIX "/%u", slot);
    int rc = settings_delete(key);
    if (rc) { return rc; }
    k_mutex_lock(&rt_holdtap_lock, K_FOREVER);
    slots[slot].has_saved = false;
    if (slots[slot].registered && slots[slot].live) {
        *slots[slot].live = slots[slot].dt_default;
    }
    k_mutex_unlock(&rt_holdtap_lock);
    return 0;
}

const char *rt_holdtap_behavior_name(uint8_t slot) {
    if (slot >= SLOTS || !slots[slot].registered) {
        return NULL;
    }
    return slots[slot].behavior_name;
}

bool rt_holdtap_registered(uint8_t slot) {
    return slot < SLOTS && slots[slot].registered;
}

void rt_holdtap_clear_all(void) {
    for (uint8_t s = 0; s < SLOTS; s++) {
        rt_holdtap_reset(s);
    }
}

