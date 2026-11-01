#include "ryong_fw/core.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static ry_profile_t default_profile(void) {
    ry_profile_t p = {0};
    p.schema_version = RY_SCHEMA_VERSION;
    p.physical_key_count = 61;
    p.layer_count = 3;
    return p;
}

static ry_combo_t combo2(uint8_t a, uint8_t b, uint16_t code) {
    ry_combo_t c = {0};
    c.key_count = 2;
    c.positions[0] = a;
    c.positions[1] = b;
    c.timeout_ms = 50;
    c.action_type = RY_ACTION_KEY;
    c.action_id = code;
    return c;
}

static void test_initialization_and_transaction(void) {
    ry_store_t s;
    ry_profile_t p = default_profile();
    assert(ry_store_init(&s, &p) == RY_OK);
    assert(s.active.layer_count == 3);
    assert(ry_store_commit(&s) == RY_ERR_TRANSACTION);
    assert(ry_store_begin(&s) == RY_OK);
    assert(ry_store_begin(&s) == RY_ERR_TRANSACTION);
    assert(ry_store_set_key(&s, 1, 30, 0x29) == RY_OK);
    assert(s.active.keymaps[1][30] == 0);
    assert(ry_store_commit(&s) == RY_OK);
    assert(s.active.keymaps[1][30] == 0x29);
    assert(s.generation == 1);
    assert(ry_store_begin(&s) == RY_OK);
    assert(ry_store_set_key(&s, 1, 30, 0x2A) == RY_OK);
    assert(ry_store_abort(&s) == RY_OK);
    assert(s.active.keymaps[1][30] == 0x29);
    assert(s.generation == 1);
}

static void test_invalid_commit_is_non_destructive(void) {
    ry_store_t s;
    ry_profile_t p = default_profile();
    assert(ry_store_init(&s, &p) == RY_OK);
    assert(ry_store_begin(&s) == RY_OK);
    ry_combo_t c = combo2(0, 61, 0x29);
    assert(ry_store_append_combo(&s, &c) == RY_OK);
    assert(ry_store_commit(&s) == RY_ERR_INVALID);
    assert(s.active.combo_count == 0);
    assert(s.generation == 0);
    assert(s.editing);
    assert(ry_store_abort(&s) == RY_OK);
}

static void test_macro_and_combo_refs(void) {
    ry_profile_t p = default_profile();
    ry_combo_t c = combo2(1, 2, 1);
    c.action_type = RY_ACTION_MACRO;
    p.combo_count = 1;
    p.combos[0] = c;
    assert(ry_profile_validate(&p) == RY_ERR_REFERENCE);
    p.macro_count = 1;
    p.macros[0].id = 1;
    p.macros[0].step_count = 2;
    p.macros[0].steps[0].type = RY_MACRO_PRESS;
    p.macros[0].steps[0].code = 4;
    p.macros[0].steps[1].type = RY_MACRO_RELEASE;
    p.macros[0].steps[1].code = 4;
    assert(ry_profile_validate(&p) == RY_OK);
    p.macros[0].steps[1].type = 255;
    assert(ry_profile_validate(&p) == RY_ERR_INVALID);
}

static void test_combo_matching(void) {
    ry_profile_t p = default_profile();
    p.combo_count = 1;
    p.combos[0] = combo2(2, 7, 0x29);
    assert(ry_profile_validate(&p) == RY_OK);
    const uint8_t a[] = {2, 7};
    const uint8_t b[] = {7, 2};
    const uint8_t c[] = {2, 8};
    const uint8_t d[] = {2, 2};
    assert(ry_combo_match(&p, a, 2, 0) == 0);
    assert(ry_combo_match(&p, b, 2, 50) == 0);
    assert(ry_combo_match(&p, b, 2, 51) == -1);
    assert(ry_combo_match(&p, c, 2, 10) == -1);
    assert(ry_combo_match(&p, d, 2, 10) == -1);
    assert(ry_combo_match(&p, a, 1, 10) == -1);
    assert(ry_combo_match(NULL, a, 2, 10) == -1);
}

static void test_bounds_and_conflicts(void) {
    ry_profile_t p = default_profile();
    p.schema_version = 0;
    assert(ry_profile_validate(&p) == RY_ERR_SCHEMA);
    p = default_profile();
    p.physical_key_count = RY_MAX_KEYS + 1;
    assert(ry_profile_validate(&p) == RY_ERR_LIMIT);
    p = default_profile();
    p.combo_count = 2;
    p.combos[0] = combo2(1, 4, 0x29);
    p.combos[1] = combo2(4, 1, 0x2A);
    assert(ry_profile_validate(&p) == RY_ERR_DUPLICATE);
    p.combos[1] = combo2(4, 4, 0x2A);
    assert(ry_profile_validate(&p) == RY_ERR_DUPLICATE);
    p.combos[1] = combo2(4, 62, 0x2A);
    assert(ry_profile_validate(&p) == RY_ERR_INVALID);
    p.combos[1] = combo2(4, 5, 0x2A);
    assert(ry_profile_validate(&p) == RY_OK);

    ry_store_t s;
    assert(ry_store_init(&s, &p) == RY_OK);
    assert(ry_store_set_key(&s, 0, 0, 2) == RY_ERR_TRANSACTION);
    assert(ry_store_begin(&s) == RY_OK);
    assert(ry_store_set_key(&s, 7, 0, 2) == RY_ERR_INVALID);
    assert(ry_store_set_key(&s, 0, 61, 2) == RY_ERR_INVALID);
    assert(ry_store_set_key(&s, 0, 0, 300) == RY_ERR_INVALID);
    assert(ry_store_abort(&s) == RY_OK);
}

int main(void) {
    test_initialization_and_transaction();
    test_invalid_commit_is_non_destructive();
    test_macro_and_combo_refs();
    test_combo_matching();
    test_bounds_and_conflicts();
    puts("Ryong core host tests: all passed");
    return 0;
}
