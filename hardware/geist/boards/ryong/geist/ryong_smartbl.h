/* geist geist-UG4-SB Smart Backlight (ryong_smartbl.c) */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <dt-bindings/ryong/smart_backlight.h>
#define RYONG_SBL_TOG SBL_TOG
#define RYONG_SBL_ON SBL_ON
#define RYONG_SBL_OFF SBL_OFF
#define RYONG_SBL_UP SBL_UP
#define RYONG_SBL_DN SBL_DN
int ryong_sbl_set(int cmd);
bool ryong_sbl_enabled(void);
uint8_t ryong_sbl_sensitivity(void);
bool ryong_sbl_near(void);
/* true while the sensor reports a compensation failure on phase 0 (see ryong_smartbl.c) */
bool ryong_sbl_fault(void);
/* true after repeated baseline failures: sensor off until USB changes or &sbl is used */
bool ryong_sbl_suspended(void);
/* true when typing hands do not show in the readings on this build (e.g. grounded metal plate): sensor left off */
bool ryong_sbl_blind(void);
/* sensor phases off before deep sleep / soft off */
void ryong_sbl_sleep(void);
/* diagnostics, aF: last summed delta, typing span (0 = not learned yet), threshold in use */
int32_t ryong_sbl_delta_af(void);
int32_t ryong_sbl_span_af(void);
int32_t ryong_sbl_threshold_af(void);
