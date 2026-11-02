#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <ryong/ble_profile_core.h>

static size_t enc(uint8_t *out, const uint8_t *owner, const char *name) {
    return ry_bt_record_encode(out, owner, name, strlen(name));
}

int main(void) {
    /* Names: Korean, English, emoji, limits and rejected forms. */
    assert(ry_bt_name_valid("", 0));
    assert(ry_bt_name_valid("맥북", strlen("맥북")));
    assert(ry_bt_name_valid("회사 PC", strlen("회사 PC")));
    assert(ry_bt_name_valid("iPhone 📱", strlen("iPhone 📱")));
    assert(ry_bt_name_valid("가나다라마바사아자차", 30)); /* 10 Hangul = 30 bytes */
    assert(!ry_bt_name_valid("가나다라마바사아자차카", 33));
    assert(!ry_bt_name_valid(" lead", 5) && !ry_bt_name_valid("trail ", 6));
    assert(!ry_bt_name_valid("a\nb", 3) && !ry_bt_name_valid("a\x7f", 2));
    assert(!ry_bt_name_valid("\xc0\xaf", 2));         /* overlong '/' */
    assert(!ry_bt_name_valid("\xed\xa0\x80", 3));     /* surrogate */
    assert(!ry_bt_name_valid("\xc2\x85", 2));         /* C1 NEL */
    assert(!ry_bt_name_valid("\xe2\x80\xae" "x", 4)); /* RTL override */
    assert(!ry_bt_name_valid("\xe2\x82", 2));         /* truncated */
    assert(!ry_bt_name_valid("\xf4\x90\x80\x80", 4)); /* > U+10FFFF */
    assert(!ry_bt_name_valid("\xff", 1));
    assert(!ry_bt_name_valid(NULL, 3));

    const uint8_t empty[RY_BT_ADDR_SIZE] = {0};
    const uint8_t mac[RY_BT_ADDR_SIZE] = {1, 0x11, 0x22, 0x33, 0x44, 0x55, 0xc6};
    const uint8_t pc[RY_BT_ADDR_SIZE] = {1, 0x11, 0x22, 0x33, 0x44, 0x55, 0xc7};
    uint8_t rec[RY_BT_RECORD_MAX];
    char out[RY_BT_NAME_MAX + 1];

    assert(ry_bt_owner_empty(empty) && !ry_bt_owner_empty(mac));
    assert(enc(rec, empty, "맥북") == 0);   /* empty slot cannot be named */
    assert(enc(rec, mac, "") == 0);         /* empty name means delete, not a record */
    assert(enc(rec, mac, " bad") == 0);
    size_t n = enc(rec, mac, "맥북");
    assert(n == RY_BT_RECORD_HEADER + strlen("맥북"));
    assert(ry_bt_record_decode(rec, n, mac, out) && !strcmp(out, "맥북"));
    assert(!ry_bt_record_stale(rec, n, mac));

    /* Re-paired slot: the old host's name is not shown and is purgeable. */
    assert(!ry_bt_record_decode(rec, n, pc, out) && out[0] == '\0');
    assert(ry_bt_record_stale(rec, n, pc));
    assert(!ry_bt_record_decode(rec, n, empty, out) && ry_bt_record_stale(rec, n, empty));

    /* Corruption: truncated, wrong length, wrong version, invalid UTF-8. */
    assert(!ry_bt_record_decode(rec, n - 1, mac, out) && ry_bt_record_stale(rec, n - 1, mac));
    uint8_t bad[RY_BT_RECORD_MAX];
    memcpy(bad, rec, n); bad[0] = 2;
    assert(!ry_bt_record_decode(bad, n, mac, out));
    memcpy(bad, rec, n); bad[RY_BT_RECORD_HEADER] = 0xff;
    assert(!ry_bt_record_decode(bad, n, mac, out) && ry_bt_record_stale(bad, n, mac));
    assert(!ry_bt_record_decode(NULL, 0, mac, out) && !ry_bt_record_stale(NULL, 0, mac));
    assert(!ry_bt_record_stale(rec, 0, mac));

    /* Tokens: 0 only for empty, differ by slot/host/boot salt, never leak bytes. */
    assert(ry_bt_token(7, 0, empty) == 0);
    uint32_t t = ry_bt_token(7, 0, mac);
    assert(t && t == ry_bt_token(7, 0, mac));
    assert(t != ry_bt_token(7, 0, pc) && t != ry_bt_token(7, 1, mac) && t != ry_bt_token(8, 0, mac));
    puts("BLE profile core: UTF-8 names, owner binding, stale purge, corruption and tokens passed");
    return 0;
}
