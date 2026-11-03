/* SPDX-License-Identifier: MIT */
/*
 * The keyboard's USB name follows its Bluetooth name (renamed on the web page, stored by Zephyr
 * as "bt/name"; firmware updates keep it). At power-up, before ZMK starts USB, the stored name
 * (or the build's name) is written into the product string descriptor (usb_name_core.c).
 * firmware-build.yml reserves 16 characters of room in that descriptor.
 */
#include <string.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/settings/settings.h>
#include <zephyr/usb/usb_ch9.h>
#include <zephyr/logging/log.h>
#include <ryong/usb_name_core.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

uint8_t *usb_get_device_descriptor(void);             /* Zephyr legacy USB stack */
extern struct usb_desc_header __usb_descriptor_end[]; /* end of the descriptor section */

static char name[CONFIG_BT_DEVICE_NAME_MAX + 1];

static int name_cb(const char *key, size_t len, settings_read_cb read_cb, void *cb_arg, void *param) {
    ARG_UNUSED(param);
    if (key && key[0]) return 0;
    ssize_t n = read_cb(cb_arg, name, MIN(len, sizeof(name) - 1));
    name[n > 0 ? n : 0] = '\0';
    return 0;
}

static int usb_name_init(void) {
    if (settings_subsys_init() == 0) {
        (void)settings_load_subtree_direct("bt/name", name_cb, NULL);
    }
    const char *use = name[0] ? name : CONFIG_BT_DEVICE_NAME;
    uint8_t *start = usb_get_device_descriptor(); /* converts the strings to UTF-16 once */
    int n = start ? ry_usb_name_apply(start, (uint8_t *)__usb_descriptor_end, use) : -1;
    if (n < 0) LOG_WRN("USB name left as built");
    else LOG_INF("USB name: %s", use);
    return 0;
}
/* After the flash and settings back end, before ZMK's USB HID (95) and USB start (96). */
SYS_INIT(usb_name_init, APPLICATION, 90);
