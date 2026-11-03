/* SPDX-License-Identifier: MIT */
/*
 * The keyboard's name over USB follows its Bluetooth name (renamed on the web page, stored by
 * Zephyr as "bt/name"). The USB product string is fixed at build time, so at power-up, before
 * USB starts, the stored name is written into that descriptor (UTF-16, Korean included). Its room
 * is the build-time product string's length: firmware-build.yml reserves 16 characters.
 */
#include <string.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zephyr/usb/usb_ch9.h>
#include <zephyr/logging/log.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

uint8_t *usb_get_device_descriptor(void); /* Zephyr's legacy USB stack (usb_descriptor.c) */

static char name[CONFIG_BT_DEVICE_NAME_MAX + 1];

static int name_cb(const char *key, size_t len, settings_read_cb read_cb, void *cb_arg, void *param) {
    ARG_UNUSED(param);
    if (key && key[0]) return 0;
    ssize_t n = read_cb(cb_arg, name, MIN(len, sizeof(name) - 1));
    name[n > 0 ? n : 0] = '\0';
    return 0;
}

/* Next code point of UTF-8 text, '?' for anything outside the basic plane or malformed. */
static uint16_t next_cp(const char **s) {
    const uint8_t *p = (const uint8_t *)*s;
    uint32_t cp = '?';
    int n = 1;
    if (p[0] < 0x80) cp = p[0];
    else if ((p[0] & 0xE0) == 0xC0 && p[1]) { cp = (p[0] & 0x1F) << 6 | (p[1] & 0x3F); n = 2; }
    else if ((p[0] & 0xF0) == 0xE0 && p[1] && p[2]) { cp = (p[0] & 0x0F) << 12 | (p[1] & 0x3F) << 6 | (p[2] & 0x3F); n = 3; }
    else if ((p[0] & 0xF8) == 0xF0 && p[1] && p[2] && p[3]) n = 4;
    *s += n;
    return cp > 0xFFFF ? '?' : (uint16_t)cp;
}

static int usb_name_init(void) {
    if (settings_subsys_init() == 0) {
        (void)settings_load_subtree_direct("bt/name", name_cb, NULL);
    }
    const char *use = name[0] ? name : CONFIG_BT_DEVICE_NAME;
    uint8_t *p = usb_get_device_descriptor(); /* fixes the descriptors once (UTF-16 strings) */
    for (int strings = 0; p && p[0]; p += p[0]) {
        if (p[1] != USB_DESC_STRING) continue;
        if (strings++ != 2) continue; /* 0 language, 1 manufacturer, 2 product */
        int room = (p[0] - 2) / 2, units = 0;
        for (const char *s = use; *s && units < room; units++) {
            uint16_t cp = next_cp(&s);
            p[2 + units * 2] = cp & 0xFF;
            p[3 + units * 2] = cp >> 8;
        }
        p[0] = (uint8_t)(2 + units * 2);
        LOG_INF("USB name: %s", use);
        break;
    }
    return 0;
}
/* After the flash and settings back end, before ZMK's USB HID (95) and USB start (96). */
SYS_INIT(usb_name_init, APPLICATION, 90);
