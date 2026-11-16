/* geist: underglow low-battery decision (no ZMK dependencies; native_sim test uses it too).
 * The underglow takes up to 0.40 A through U84 (TPS2553). The same charge guard applies on battery and on plain USB
 * (450 mA input limit: no battery reads as 0 % = off). A fast charger carries it. */
#include <stdbool.h>
#include <stdint.h>
#include <zephyr/autoconf.h>
#include "ryong_keyleds.h"

/* pure decision step (also used by the native_sim test): true = underglow must be off */
bool ryong_ug_batt_low(bool was_low, bool usb, bool fast, uint8_t soc)
{
    if (usb && fast) {
        return false;
    }
    if (was_low) {
        return soc < CONFIG_RYONG_UG_BAT_ON_PCT;
    }
    return soc <= CONFIG_RYONG_UG_BAT_OFF_PCT;
}

