/* SPDX-License-Identifier: MIT */
#include <string.h>
#include <ryong/ble_profile_core.h>

bool ry_bt_name_valid(const char *name, size_t len) {
    if (len == 0) return true;
    if (!name || len > RY_BT_NAME_MAX) return false;
    const uint8_t *s = (const uint8_t *)name;
    if (s[0] == ' ' || s[len - 1] == ' ') return false;
    for (size_t i = 0; i < len;) {
        uint8_t c = s[i];
        if (c < 0x20 || c == 0x7f) return false;
        if (c < 0x80) { i++; continue; }
        size_t n;
        uint32_t cp;
        if (c >= 0xc2 && c <= 0xdf) { n = 2; cp = c & 0x1f; }
        else if (c >= 0xe0 && c <= 0xef) { n = 3; cp = c & 0x0f; }
        else if (c >= 0xf0 && c <= 0xf4) { n = 4; cp = c & 0x07; }
        else return false;
        if (i + n > len) return false;
        for (size_t k = 1; k < n; k++) {
            if ((s[i + k] & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (s[i + k] & 0x3f);
        }
        if ((n == 3 && cp < 0x800) || (n == 4 && (cp < 0x10000 || cp > 0x10ffff)) ||
            (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x80 && cp <= 0x9f) ||
            cp == 0x2028 || cp == 0x2029 || (cp >= 0x202a && cp <= 0x202e) ||
            (cp >= 0x2066 && cp <= 0x2069)) {
            return false; /* overlong, surrogate, C1, separators, bidi overrides */
        }
        i += n;
    }
    return true;
}

bool ry_bt_owner_empty(const uint8_t owner[RY_BT_ADDR_SIZE]) {
    for (size_t i = 0; i < RY_BT_ADDR_SIZE; i++) {
        if (owner[i]) return false;
    }
    return true;
}

size_t ry_bt_record_encode(uint8_t out[RY_BT_RECORD_MAX], const uint8_t owner[RY_BT_ADDR_SIZE],
                           const char *name, size_t len) {
    if (len == 0 || !ry_bt_name_valid(name, len) || ry_bt_owner_empty(owner)) return 0;
    out[0] = RY_BT_RECORD_VERSION;
    memcpy(out + 1, owner, RY_BT_ADDR_SIZE);
    out[1 + RY_BT_ADDR_SIZE] = (uint8_t)len;
    memcpy(out + RY_BT_RECORD_HEADER, name, len);
    return RY_BT_RECORD_HEADER + len;
}

static bool well_formed(const uint8_t *in, size_t size) {
    if (!in || size <= RY_BT_RECORD_HEADER || size > RY_BT_RECORD_MAX) return false;
    if (in[0] != RY_BT_RECORD_VERSION) return false;
    size_t len = in[1 + RY_BT_ADDR_SIZE];
    return len && size == RY_BT_RECORD_HEADER + len &&
           ry_bt_name_valid((const char *)in + RY_BT_RECORD_HEADER, len);
}

bool ry_bt_record_decode(const uint8_t *in, size_t size, const uint8_t owner[RY_BT_ADDR_SIZE],
                         char out[RY_BT_NAME_MAX + 1]) {
    out[0] = '\0';
    if (!well_formed(in, size) || ry_bt_owner_empty(owner) ||
        memcmp(in + 1, owner, RY_BT_ADDR_SIZE)) {
        return false;
    }
    size_t len = in[1 + RY_BT_ADDR_SIZE];
    memcpy(out, in + RY_BT_RECORD_HEADER, len);
    out[len] = '\0';
    return true;
}

bool ry_bt_record_stale(const uint8_t *in, size_t size, const uint8_t owner[RY_BT_ADDR_SIZE]) {
    if (!in || size == 0) return false;
    /* Malformed bytes are treated as stale so they get purged too. */
    if (!well_formed(in, size)) return true;
    return ry_bt_owner_empty(owner) || memcmp(in + 1, owner, RY_BT_ADDR_SIZE) != 0;
}

uint32_t ry_bt_token(uint32_t salt, uint8_t index, const uint8_t owner[RY_BT_ADDR_SIZE]) {
    if (ry_bt_owner_empty(owner)) return 0;
    uint32_t h = 2166136261u ^ salt;
    h = (h ^ index) * 16777619u;
    for (size_t i = 0; i < RY_BT_ADDR_SIZE; i++) h = (h ^ owner[i]) * 16777619u;
    h ^= h >> 15;
    h *= 0x2c1b3c6du;
    h ^= h >> 12;
    return h ? h : 1;
}
