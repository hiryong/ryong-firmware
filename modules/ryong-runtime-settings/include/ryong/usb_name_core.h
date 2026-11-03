/* SPDX-License-Identifier: MIT */
#pragma once
#include <stddef.h>
#include <stdint.h>
/*
 * Put `name` (UTF-8) into the USB product string descriptor of an already fixed-up (UTF-16)
 * descriptor block [start, end). Zephyr finds every descriptor by walking bLength from the
 * start, so when the new string is shorter, everything after it is moved up to close the gap
 * (the terminator included) - a shortened bLength alone left the rest unreadable and the
 * computer could not enumerate the keyboard. The name is cut to the room the build reserved.
 * Returns the number of UTF-16 units written, or -1 if the layout is not as expected.
 */
int ry_usb_name_apply(uint8_t *start, uint8_t *end, const char *name);
