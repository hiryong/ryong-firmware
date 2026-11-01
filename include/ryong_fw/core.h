#ifndef RYONG_FW_CORE_H
#define RYONG_FW_CORE_H

#include <stdbool.h>
#include <stdint.h>

/* Host-test prototype limits; these are not final product promises. */
#define RY_SCHEMA_VERSION 1u
#define RY_MAX_KEYS 96u
#define RY_MAX_LAYERS 8u
#define RY_MAX_COMBOS 24u
#define RY_MAX_COMBO_KEYS 4u
#define RY_MAX_MACROS 12u
#define RY_MAX_MACRO_STEPS 24u

typedef enum {
    RY_OK = 0, RY_ERR_NULL, RY_ERR_SCHEMA, RY_ERR_LIMIT,
    RY_ERR_INVALID, RY_ERR_DUPLICATE, RY_ERR_REFERENCE,
    RY_ERR_TRANSACTION
} ry_result_t;

typedef enum { RY_ACTION_KEY = 1, RY_ACTION_MACRO = 2 } ry_action_type_t;
typedef enum { RY_MACRO_PRESS = 1, RY_MACRO_RELEASE = 2,
               RY_MACRO_DELAY = 3 } ry_macro_step_type_t;

typedef struct {
    uint8_t type;
    uint16_t code;
    uint16_t delay_ms;
} ry_macro_step_t;

typedef struct {
    uint8_t id;
    uint8_t step_count;
    ry_macro_step_t steps[RY_MAX_MACRO_STEPS];
} ry_macro_t;

typedef struct {
    uint8_t key_count;
    uint8_t positions[RY_MAX_COMBO_KEYS]; /* physical key index */
    uint16_t timeout_ms;
    uint8_t action_type;
    uint16_t action_id;
} ry_combo_t;

typedef struct {
    uint16_t schema_version;
    uint8_t physical_key_count;
    uint8_t layer_count;
    uint8_t combo_count;
    uint8_t macro_count;
    uint16_t keymaps[RY_MAX_LAYERS][RY_MAX_KEYS]; /* usage 0=transparent */
    ry_combo_t combos[RY_MAX_COMBOS];
    ry_macro_t macros[RY_MAX_MACROS];
} ry_profile_t;

typedef struct {
    ry_profile_t active;
    ry_profile_t staged;
    uint32_t generation;
    bool editing;
} ry_store_t;

/* RAM-only transactions; not thread-safe or flash-backed. */
ry_result_t ry_profile_validate(const ry_profile_t *profile);
ry_result_t ry_store_init(ry_store_t *store, const ry_profile_t *factory);
ry_result_t ry_store_begin(ry_store_t *store);
ry_profile_t *ry_store_staged(ry_store_t *store);
ry_result_t ry_store_commit(ry_store_t *store);
ry_result_t ry_store_abort(ry_store_t *store);
ry_result_t ry_store_set_key(ry_store_t *store, uint8_t layer,
                              uint8_t position, uint16_t usage);
ry_result_t ry_store_append_combo(ry_store_t *store, const ry_combo_t *combo);
ry_result_t ry_store_append_macro(ry_store_t *store, const ry_macro_t *macro);

/* Pure matcher only. No event buffering, suppression, ZMK dispatch or HID. */
int ry_combo_match(const ry_profile_t *profile, const uint8_t *held,
                   uint8_t held_count, uint16_t elapsed_ms);

#endif
