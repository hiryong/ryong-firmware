#include "ryong_fw/core.h"

#include <string.h>

static bool macro_id_exists(const ry_profile_t *p, uint16_t id) {
    for (uint8_t i = 0; i < p->macro_count; ++i)
        if (p->macros[i].id == id) return true;
    return false;
}

static bool same_combo_set(const ry_combo_t *a, const ry_combo_t *b) {
    if (a->key_count != b->key_count) return false;
    for (uint8_t i = 0; i < a->key_count; ++i) {
        bool found = false;
        for (uint8_t j = 0; j < b->key_count; ++j)
            if (a->positions[i] == b->positions[j]) { found = true; break; }
        if (!found) return false;
    }
    return true;
}

ry_result_t ry_profile_validate(const ry_profile_t *p) {
    if (!p) return RY_ERR_NULL;
    if (p->schema_version != RY_SCHEMA_VERSION) return RY_ERR_SCHEMA;
    if (!p->physical_key_count || p->physical_key_count > RY_MAX_KEYS ||
        !p->layer_count || p->layer_count > RY_MAX_LAYERS ||
        p->combo_count > RY_MAX_COMBOS || p->macro_count > RY_MAX_MACROS)
        return RY_ERR_LIMIT;

    for (uint8_t l = 0; l < p->layer_count; ++l)
        for (uint8_t k = 0; k < p->physical_key_count; ++k)
            if (p->keymaps[l][k] > 0xFFu) return RY_ERR_INVALID;

    for (uint8_t i = 0; i < p->macro_count; ++i) {
        const ry_macro_t *m = &p->macros[i];
        if (m->id >= RY_MAX_MACROS || !m->step_count ||
            m->step_count > RY_MAX_MACRO_STEPS) return RY_ERR_LIMIT;
        for (uint8_t j = 0; j < i; ++j)
            if (p->macros[j].id == m->id) return RY_ERR_DUPLICATE;
        for (uint8_t s = 0; s < m->step_count; ++s) {
            const ry_macro_step_t *st = &m->steps[s];
            if (st->type == RY_MACRO_DELAY) {
                if (st->code != 0 || st->delay_ms == 0 || st->delay_ms > 5000)
                    return RY_ERR_INVALID;
            } else if (st->type == RY_MACRO_PRESS ||
                       st->type == RY_MACRO_RELEASE) {
                if (st->code == 0 || st->code > 0xFFu || st->delay_ms != 0)
                    return RY_ERR_INVALID;
            } else return RY_ERR_INVALID;
        }
    }

    for (uint8_t i = 0; i < p->combo_count; ++i) {
        const ry_combo_t *c = &p->combos[i];
        if (c->key_count < 2 || c->key_count > RY_MAX_COMBO_KEYS ||
            c->timeout_ms == 0 || c->timeout_ms > 1000)
            return RY_ERR_INVALID;
        for (uint8_t a = 0; a < c->key_count; ++a) {
            if (c->positions[a] >= p->physical_key_count)
                return RY_ERR_INVALID;
            for (uint8_t b = 0; b < a; ++b)
                if (c->positions[a] == c->positions[b])
                    return RY_ERR_DUPLICATE;
        }
        if (c->action_type == RY_ACTION_KEY) {
            if (c->action_id == 0 || c->action_id > 0xFFu)
                return RY_ERR_INVALID;
        } else if (c->action_type == RY_ACTION_MACRO) {
            if (!macro_id_exists(p, c->action_id)) return RY_ERR_REFERENCE;
        } else return RY_ERR_INVALID;
        for (uint8_t j = 0; j < i; ++j)
            if (same_combo_set(c, &p->combos[j]))
                return RY_ERR_DUPLICATE;
    }
    return RY_OK;
}

ry_result_t ry_store_init(ry_store_t *store, const ry_profile_t *factory) {
    if (!store || !factory) return RY_ERR_NULL;
    ry_result_t result = ry_profile_validate(factory);
    if (result != RY_OK) return result;
    memset(store, 0, sizeof(*store));
    memcpy(&store->active, factory, sizeof(*factory));
    return RY_OK;
}

ry_result_t ry_store_begin(ry_store_t *store) {
    if (!store) return RY_ERR_NULL;
    if (store->editing) return RY_ERR_TRANSACTION;
    memcpy(&store->staged, &store->active, sizeof(store->staged));
    store->editing = true;
    return RY_OK;
}

ry_profile_t *ry_store_staged(ry_store_t *store) {
    return store && store->editing ? &store->staged : NULL;
}

ry_result_t ry_store_commit(ry_store_t *store) {
    if (!store) return RY_ERR_NULL;
    if (!store->editing) return RY_ERR_TRANSACTION;
    ry_result_t result = ry_profile_validate(&store->staged);
    if (result != RY_OK) return result;
    memcpy(&store->active, &store->staged, sizeof(store->active));
    store->editing = false;
    store->generation++;
    return RY_OK;
}

ry_result_t ry_store_abort(ry_store_t *store) {
    if (!store) return RY_ERR_NULL;
    if (!store->editing) return RY_ERR_TRANSACTION;
    store->editing = false;
    return RY_OK;
}

ry_result_t ry_store_set_key(ry_store_t *store, uint8_t layer,
                              uint8_t position, uint16_t usage) {
    ry_profile_t *p = ry_store_staged(store);
    if (!p) return RY_ERR_TRANSACTION;
    if (layer >= p->layer_count || position >= p->physical_key_count ||
        usage > 0xFFu) return RY_ERR_INVALID;
    p->keymaps[layer][position] = usage;
    return RY_OK;
}

ry_result_t ry_store_append_combo(ry_store_t *store, const ry_combo_t *combo) {
    if (!store || !combo) return RY_ERR_NULL;
    ry_profile_t *p = ry_store_staged(store);
    if (!p) return RY_ERR_TRANSACTION;
    if (p->combo_count >= RY_MAX_COMBOS) return RY_ERR_LIMIT;
    p->combos[p->combo_count++] = *combo;
    return RY_OK;
}

ry_result_t ry_store_append_macro(ry_store_t *store, const ry_macro_t *macro) {
    if (!store || !macro) return RY_ERR_NULL;
    ry_profile_t *p = ry_store_staged(store);
    if (!p) return RY_ERR_TRANSACTION;
    if (p->macro_count >= RY_MAX_MACROS) return RY_ERR_LIMIT;
    p->macros[p->macro_count++] = *macro;
    return RY_OK;
}

int ry_combo_match(const ry_profile_t *p, const uint8_t *held,
                   uint8_t held_count, uint16_t elapsed_ms) {
    if (!p || !held || !held_count) return -1;
    for (uint8_t i = 0; i < p->combo_count; ++i) {
        const ry_combo_t *c = &p->combos[i];
        if (c->key_count != held_count || elapsed_ms > c->timeout_ms)
            continue;
        bool match = true;
        for (uint8_t a = 0; a < held_count; ++a) {
            bool found = false;
            for (uint8_t b = 0; b < c->key_count; ++b)
                if (held[a] == c->positions[b]) { found = true; break; }
            if (!found) { match = false; break; }
            for (uint8_t b = 0; b < a; ++b)
                if (held[b] == held[a]) { match = false; break; }
            if (!match) break;
        }
        if (match) return (int)i;
    }
    return -1;
}
