/* SPDX-License-Identifier: MIT */
#include <string.h>
#include <ryong/usb_name_core.h>

#define DESC_STRING 0x03

static uint16_t next_cp(const char **s) {
    const uint8_t *p = (const uint8_t *)*s;
    uint32_t cp = '?';
    int n = 1;
    if (p[0] < 0x80) cp = p[0];
    else if ((p[0] & 0xE0) == 0xC0 && p[1]) { cp = (uint32_t)(p[0] & 0x1F) << 6 | (p[1] & 0x3F); n = 2; }
    else if ((p[0] & 0xF0) == 0xE0 && p[1] && p[2]) { cp = (uint32_t)(p[0] & 0x0F) << 12 | (uint32_t)(p[1] & 0x3F) << 6 | (p[2] & 0x3F); n = 3; }
    else if ((p[0] & 0xF8) == 0xF0 && p[1] && p[2] && p[3]) n = 4;
    *s += n;
    return cp > 0xFFFF || cp < 0x20 ? '?' : (uint16_t)cp;
}

int ry_usb_name_apply(uint8_t *start, uint8_t *end, const char *name) {
    uint8_t *p = start, *product = NULL;
    int strings = 0;
    while (p + 2 <= end && p[0] != 0) {
        if (p + p[0] > end || p[0] < 2) return -1;
        if (p[1] == DESC_STRING && strings++ == 2) { product = p; break; } /* 0 language, 1 maker, 2 product */
        p += p[0];
    }
    if (!product || !name || !name[0]) return -1;
    /* the terminator (bLength 0) after the product string */
    uint8_t *term = product + product[0];
    while (term + 2 <= end && term[0] != 0) {
        if (term[0] < 2 || term + term[0] > end) return -1;
        term += term[0];
    }
    if (term + 2 > end) return -1;
    int room = (product[0] - 2) / 2, units = 0;
    uint16_t buf[64];
    for (const char *s = name; *s && units < room && units < 64; units++) buf[units] = next_cp(&s);
    while (units > 0 && buf[units - 1] == ' ') units--; /* no trailing blanks */
    if (units == 0) return -1;
    uint8_t new_len = (uint8_t)(2 + units * 2), old_len = product[0];
    uint8_t *tail = product + old_len;
    size_t tail_len = (size_t)(term + 2 - tail); /* following descriptors + terminator */
    for (int i = 0; i < units; i++) { product[2 + i * 2] = buf[i] & 0xFF; product[3 + i * 2] = buf[i] >> 8; }
    memmove(product + new_len, tail, tail_len);
    product[0] = new_len;
    return units;
}
