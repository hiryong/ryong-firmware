/* Keyboard-side settings: record format, validation, light rules, deep-sleep decision. */
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <ryong/settings_core.h>

static void test_defaults_and_roundtrip(void) {
    struct ry_settings s, t;
    ry_rs_defaults(&s, 15, false);
    assert(s.sleep_enabled && s.sleep_minutes == 15);
    assert(!s.backlight.use && !s.underglow.use);
    assert(s.underglow.usb_only);
    ry_rs_defaults(&s, 0, true);
    assert(!s.sleep_enabled && s.sleep_minutes == 15 && s.backlight.use);
    s.sleep_minutes = 1440; s.backlight.brightness = 100; s.underglow.brightness = 0; s.underglow.on_at_start = false;
    uint8_t rec[RY_RS_RECORD_SIZE];
    assert(ry_rs_encode(&s, rec) == RY_RS_RECORD_SIZE);
    memset(&t, 0xff, sizeof(t));
    assert(ry_rs_decode(rec, sizeof(rec), &t) == 0);
    assert(memcmp(&s, &t, sizeof(s)) == 0 || (t.sleep_minutes == 1440 && t.backlight.brightness == 100 && !t.underglow.on_at_start));
}

static void test_reject_bad_records(void) {
    struct ry_settings s, t;
    ry_rs_defaults(&s, 15, true);
    uint8_t rec[RY_RS_RECORD_SIZE];
    ry_rs_encode(&s, rec);
    t = s;
    for (size_t i = 0; i < RY_RS_RECORD_SIZE; i++) {
        uint8_t bad[RY_RS_RECORD_SIZE];
        memcpy(bad, rec, sizeof(bad));
        bad[i] ^= 0x40;
        assert(ry_rs_decode(bad, sizeof(bad), &t) == -EINVAL);
        assert(memcmp(&t, &s, sizeof(s)) == 0); /* untouched on failure */
    }
    assert(ry_rs_decode(rec, sizeof(rec) - 1, &t) == -EINVAL);
    assert(ry_rs_decode(NULL, sizeof(rec), &t) == -EINVAL);
    s.sleep_minutes = 0; assert(ry_rs_validate(&s) == -EINVAL);
    s.sleep_minutes = 1441; assert(ry_rs_validate(&s) == -EINVAL);
    s.sleep_minutes = 10; s.underglow.brightness = 101; assert(ry_rs_validate(&s) == -EINVAL);
}

static void test_light_rules(void) {
    struct ry_light l = {.use = true, .on_at_start = true, .brightness = 50, .usb_only = true};
    bool wanted = true, forced = false;
    /* lit on USB: keep, intent tracks state */
    assert(ry_light_step(&l, true, true, &wanted, &forced) == RY_LIGHT_KEEP && wanted);
    /* unplugged: forced dark, wish remembered */
    assert(ry_light_step(&l, false, true, &wanted, &forced) == RY_LIGHT_FORCE_OFF && wanted && forced);
    assert(ry_light_step(&l, false, false, &wanted, &forced) == RY_LIGHT_KEEP);
    /* plugged again: restored */
    assert(ry_light_step(&l, true, false, &wanted, &forced) == RY_LIGHT_RESTORE_ON && !forced);
    /* a light the person switched off stays off when USB comes back */
    wanted = false; forced = false;
    assert(ry_light_step(&l, true, false, &wanted, &forced) == RY_LIGHT_KEEP && !wanted);
    assert(ry_light_step(&l, false, false, &wanted, &forced) == RY_LIGHT_KEEP);
    assert(ry_light_step(&l, true, false, &wanted, &forced) == RY_LIGHT_KEEP);
    /* feature off: always dark, a key turning it on is undone, and the wish is forgotten */
    l.use = false; l.usb_only = false; wanted = true; forced = false;
    assert(ry_light_step(&l, true, true, &wanted, &forced) == RY_LIGHT_FORCE_OFF && !wanted);
    l.use = true;
    assert(ry_light_step(&l, true, false, &wanted, &forced) == RY_LIGHT_KEEP);
    assert(!ry_light_allowed(&(struct ry_light){.use = false}, true));
    assert(ry_light_allowed(&(struct ry_light){.use = true, .usb_only = false}, false));
}

static void test_sleep(void) {
    struct ry_settings s;
    ry_rs_defaults(&s, 10, false);
    assert(!ry_should_sleep(&s, 10 * 60000u - 1, false));
    assert(ry_should_sleep(&s, 10 * 60000u, false));
    assert(!ry_should_sleep(&s, 60 * 60000u, true)); /* never on USB power */
    s.sleep_enabled = false;
    assert(!ry_should_sleep(&s, 0xffffffffu, false));
    s.sleep_enabled = true; s.sleep_minutes = 1440;
    assert(!ry_should_sleep(&s, 1439u * 60000u, false) && ry_should_sleep(&s, 1440u * 60000u, false));
}

static void test_indicator(void) {
    struct ry_settings s, t;
    uint8_t rec[RY_RS_RECORD_SIZE];
    ry_rs_defaults(&s, 15, true);
    assert(s.indicator.use && s.indicator.brightness == RY_RS_INDICATOR_BRT_DEFAULT);
    s.indicator.use = false; s.indicator.brightness = 30;
    ry_rs_encode(&s, rec);
    assert(ry_rs_decode(rec, sizeof(rec), &t) == 0 && !t.indicator.use && t.indicator.brightness == 30);
    /* a record written before the indicator existed: bytes 8-9 zero -> on, default brightness */
    s.indicator.use = true; s.indicator.brightness = RY_RS_INDICATOR_BRT_DEFAULT;
    ry_rs_encode(&s, rec);
    rec[8] = 0; rec[9] = 0;
    uint8_t x = 0xA5;
    for (size_t i = 0; i < RY_RS_RECORD_SIZE - 1; i++) x = (uint8_t)((x << 1 | x >> 7) ^ rec[i]);
    rec[RY_RS_RECORD_SIZE - 1] = x;
    assert(ry_rs_decode(rec, sizeof(rec), &t) == 0 && t.indicator.use && t.indicator.brightness == RY_RS_INDICATOR_BRT_DEFAULT);
    s.indicator.brightness = 0;
    assert(ry_rs_validate(&s) == -EINVAL);
}

int main(void) {
    test_indicator();
    test_defaults_and_roundtrip();
    test_reject_bad_records();
    test_light_rules();
    test_sleep();
    puts("runtime settings core: ok");
    return 0;
}
