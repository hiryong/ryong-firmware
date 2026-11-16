/* geist Ver2 fast-charger decision (pure logic, also run by the native_sim test). See ryong_charger.c. */
#include <stdbool.h>
#include <stdint.h>
#include "ryong_keyleds.h"

#define FAST_ON_MV 330  /* worst case (bq/sim/ccsense.py): default <= 0.253 V, 1.5 A >= 0.408 V incl. SAADC 1.5 % -> midpoint */
#define FAST_OFF_MV 290 /* hysteresis, still 37 mV above the default maximum */
#define ON_COUNT 3      /* 3 s in a row before raising the input limit */
#define OFF_COUNT 2

int ryong_charger_classify(int32_t mv, bool cur, int *u, int *d) {
    /* pure decision step, shared with the native_sim test */
    if (mv >= FAST_ON_MV) {
        (*u)++;
        *d = 0;
    } else if (mv < FAST_OFF_MV) {
        (*d)++;
        *u = 0;
    } else {
        *u = 0;
        *d = 0;
    }
    if (!cur && *u >= ON_COUNT) {
        return 1;
    }
    if (cur && *d >= OFF_COUNT) {
        return 0;
    }
    return cur ? 1 : 0;
}

