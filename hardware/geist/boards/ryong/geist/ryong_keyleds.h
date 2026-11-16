/*
 * geist Ver2 key LEDs: per-key access for board code (slot blink, Caps Lock, layer keys).
 * Key numbers are ZMK keymap positions 0..60 (the same numbers the keymap and ZMK Studio use).
 */
#pragma once
#include <stdint.h>

#define RYONG_KEYLED_COUNT 61

/* Override one key: value 0..100 shows that brightness regardless of the backlight level;
 * value < 0 returns the key to the normal backlight level. */
int ryong_keyled_override(uint8_t key, int value);

/* Every key dark and every override cleared (soft off). */
int ryong_keyled_all_off(void);
/* ryong_gauge_sleep.c: MAX17048 to sleep (0.5 uA) before System OFF */
int ryong_gauge_sleep(void);

/* LED self test at boot (open detection): true when that key's LED read open */
#include <stdbool.h>
bool ryong_keyled_is_open(uint8_t key);

/* ryong_charger.c (Ver2 fast charger): true while BQ24075 runs in ILIM mode on a 1.5 A / 3 A USB-C source */
bool ryong_charger_fast(void);
/* before System OFF: BQ_EN2 low (default mode) */
void ryong_charger_off(void);
/* decision step (exported for the native_sim test): returns the new state 0/1 */
int ryong_charger_classify(int32_t mv, bool cur, int *up, int *down);
/* key LEDs: re-apply the current budget now (power source changed) */
void ryong_keyleds_rebudget(void);
/* key LEDs: brightest-dot cap (% of full peak current) on battery at this state of charge */
uint32_t ryong_keyleds_bat_cap_pct(uint8_t soc);
/* lower table while the underglow is on (battery) */
uint32_t ryong_keyleds_bat_cap_pct_ug(uint8_t soc, bool underglow_on);
/* ryong_ug_batt_logic.c: true = underglow must be off. Battery or plain USB:
 * off at or below the off level until the on level. A 1.5 A / 3 A charger: always allowed. */
bool ryong_ug_batt_low(bool was_low, bool usb, bool fast, uint8_t soc);
/* ryong_ug_batt.c: run the guard again now (the charger calls it when the fast/plain USB decision changes) */
void ryong_ug_batt_recheck(void);

/* geist-UG4-SB Smart Backlight: hands near the front edge (shows the level ZMK turned off for idle) */
void ryong_keyleds_prox(bool near);
void ryong_keyleds_away(bool away);
void ryong_keyleds_key(void);
bool ryong_keyleds_prox_useful(void);
bool ryong_keyleds_blank(bool blank);
/* experiment: LED current raised by pct percent (0 = back to the budgeted value); nothing happens while dark */
void ryong_keyleds_boost(uint8_t pct);
/* true while the keys are lit only because of Smart Backlight */
bool ryong_keyleds_prox_lit(void);
