/* Host test of usb_name_core.c with a descriptor block laid out like Zephyr's (after fix-up:
 * strings in UTF-16), read back the way Zephyr answers GET_DESCRIPTOR (walking bLength). */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <ryong/usb_name_core.h>

static size_t put_str(uint8_t *p, const char *ascii) { /* UTF-16 string descriptor */
    size_t n = strlen(ascii);
    p[0] = (uint8_t)(2 + 2 * n); p[1] = 3;
    for (size_t i = 0; i < n; i++) { p[2 + 2 * i] = (uint8_t)ascii[i]; p[3 + 2 * i] = 0; }
    return p[0];
}
static size_t build(uint8_t *b) {
    size_t o = 0;
    b[o] = 18; b[o + 1] = 1; o += 18;           /* device */
    b[o] = 9; b[o + 1] = 2; o += 9;             /* configuration */
    b[o] = 9; b[o + 1] = 4; o += 9;             /* interface */
    b[o] = 7; b[o + 1] = 5; o += 7;             /* endpoint */
    b[o] = 4; b[o + 1] = 3; b[o + 2] = 9; b[o + 3] = 4; o += 4; /* language */
    o += put_str(b + o, "ZMK Project");        /* manufacturer */
    o += put_str(b + o, "Oreo            ");   /* product: 16 reserved */
    o += put_str(b + o, "ABCDEF0123456789");   /* serial */
    o += put_str(b + o, "ZMK Studio");         /* a class string after them */
    b[o] = 0; b[o + 1] = 0; o += 2;             /* terminator */
    return o;
}
/* like usb_get_descriptor(): the index-th descriptor of a type */
static uint8_t *find(uint8_t *b, int type, int index) {
    int cur = 0;
    for (uint8_t *p = b; p[0]; p += p[0]) if (p[1] == type && cur++ == index) return p;
    return NULL;
}
static void expect_str(uint8_t *d, const unsigned short *u, int n) {
    assert(d && d[0] == 2 + 2 * n && d[1] == 3);
    for (int i = 0; i < n; i++) assert((d[2 + 2 * i] | d[3 + 2 * i] << 8) == u[i]);
}
static void expect_ascii(uint8_t *d, const char *s) {
    unsigned short u[64]; int n = (int)strlen(s);
    for (int i = 0; i < n; i++) u[i] = (unsigned char)s[i];
    expect_str(d, u, n);
}
int main(void) {
    uint8_t b[256];
    size_t len = build(b);
    assert(ry_usb_name_apply(b, b + len, "Oreo") == 4);
    expect_ascii(find(b, 3, 2), "Oreo");
    expect_ascii(find(b, 3, 3), "ABCDEF0123456789"); /* the serial is still found after the move */
    expect_ascii(find(b, 3, 4), "ZMK Studio");
    assert(find(b, 2, 0) == b + 18);                  /* configuration untouched */

    len = build(b);
    assert(ry_usb_name_apply(b, b + len, "민수 키보드") == 6);  /* Korean, UTF-16 */
    const unsigned short ko[] = {0xBBFC, 0xC218, 0x20, 0xD0A4, 0xBCF4, 0xB4DC};
    expect_str(find(b, 3, 2), ko, 6);
    expect_ascii(find(b, 3, 3), "ABCDEF0123456789");

    len = build(b);
    assert(ry_usb_name_apply(b, b + len, "A very long keyboard name") == 16); /* cut to the room */
    expect_ascii(find(b, 3, 2), "A very long keyb");
    expect_ascii(find(b, 3, 3), "ABCDEF0123456789");

    len = build(b);
    assert(ry_usb_name_apply(b, b + len, "") == -1 && find(b, 3, 3) != NULL); /* nothing to do */
    assert(ry_usb_name_apply(b, b + 30, "X") == -1);                         /* truncated block */
    puts("usb name core: ok");
    return 0;
}
