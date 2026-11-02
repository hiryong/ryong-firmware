/* SPDX-License-Identifier: MIT */
/* Side-effect free helpers for Bluetooth slot names. Host-tested. */
#ifndef RYONG_BLE_PROFILE_CORE_H
#define RYONG_BLE_PROFILE_CORE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RY_BT_NAME_MAX 30
#define RY_BT_ADDR_SIZE 7 /* bt_addr_le_t: type + 6 address bytes */
#define RY_BT_RECORD_VERSION 1
#define RY_BT_RECORD_HEADER (1 + RY_BT_ADDR_SIZE + 1)
#define RY_BT_RECORD_MAX (RY_BT_RECORD_HEADER + RY_BT_NAME_MAX)

/* Valid UTF-8, 0..RY_BT_NAME_MAX bytes, no control characters, no leading or
 * trailing space. Empty means "no name". */
bool ry_bt_name_valid(const char *name, size_t len);

/* All-zero address is BT_ADDR_LE_ANY: an empty slot. */
bool ry_bt_owner_empty(const uint8_t owner[RY_BT_ADDR_SIZE]);

/* Returns encoded size, or 0 for an invalid name / empty owner. */
size_t ry_bt_record_encode(uint8_t out[RY_BT_RECORD_MAX], const uint8_t owner[RY_BT_ADDR_SIZE],
                           const char *name, size_t len);

/* true only for a well-formed record bound to exactly this owner. On success
 * out holds a NUL-terminated name. Any other case leaves out empty. */
bool ry_bt_record_decode(const uint8_t *in, size_t size, const uint8_t owner[RY_BT_ADDR_SIZE],
                         char out[RY_BT_NAME_MAX + 1]);

/* Well-formed record bound to some other host (stale after re-pairing). */
bool ry_bt_record_stale(const uint8_t *in, size_t size, const uint8_t owner[RY_BT_ADDR_SIZE]);

/* Opaque per-boot token; 0 only for an empty slot. Not a stable identifier. */
uint32_t ry_bt_token(uint32_t salt, uint8_t index, const uint8_t owner[RY_BT_ADDR_SIZE]);

#endif
