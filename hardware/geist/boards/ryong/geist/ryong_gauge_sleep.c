/*
 * geist: MAX17048 fuel gauge to sleep before the nRF52840 goes to System OFF (Soft Off and the 15 min idle sleep).
 *
 *  Datasheet (MAX17048/49 rev 8): hibernate IDD0 3 uA typ / 5 uA max, sleep 0.5 uA typ / 2 uA max (TA <= 50 C).
 *  Sleep needs MODE.EnSleep (bit 13 of reg 0x06) and then CONFIG.SLEEP (bit 7 of reg 0x0C).
 *  Waking is a reset of the nRF, and the ZMK max17048 driver clears CONFIG.SLEEP in its init, so nothing is needed
 *  on the way back. While asleep the gauge does not track the cell; it resumes from its last state on wake.
 */
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/logging/log.h>
#include <zmk/event_manager.h>
#include <zmk/events/activity_state_changed.h>
#include "ryong_keyleds.h"

LOG_MODULE_REGISTER(ryong_gauge_sleep, CONFIG_ZMK_LOG_LEVEL);

#define GAUGE DT_NODELABEL(builtin_fuel_gauge)
#define REG_MODE 0x06
#define REG_CONFIG 0x0C
#define MODE_ENSLEEP 0x2000
#define CONFIG_SLEEP 0x0080

#if DT_NODE_HAS_STATUS(GAUGE, okay)
static const struct i2c_dt_spec gauge = I2C_DT_SPEC_GET(GAUGE);

static int wr16(uint8_t reg, uint16_t v) {
    uint8_t b[3] = {reg, v >> 8, v & 0xFF};
    return i2c_write_dt(&gauge, b, sizeof(b));
}

static int rd16(uint8_t reg, uint16_t *v) {
    uint8_t b[2];
    int err = i2c_write_read_dt(&gauge, &reg, 1, b, sizeof(b));
    if (!err) {
        *v = ((uint16_t)b[0] << 8) | b[1];
    }
    return err;
}

int ryong_gauge_sleep(void) {
    if (!i2c_is_ready_dt(&gauge)) {
        return -ENODEV;
    }
    uint16_t cfg;
    int err = wr16(REG_MODE, MODE_ENSLEEP);
    if (!err) {
        err = rd16(REG_CONFIG, &cfg);
    }
    if (!err) {
        err = wr16(REG_CONFIG, cfg | CONFIG_SLEEP);
    }
    LOG_INF("fuel gauge sleep %s (%d)", err ? "failed" : "on", err);
    return err;
}

static int gauge_sleep_listener(const zmk_event_t *eh) {
    const struct zmk_activity_state_changed *ev = as_zmk_activity_state_changed(eh);
    if (ev != NULL && ev->state == ZMK_ACTIVITY_SLEEP) {
        ryong_charger_off(); /* Ver2: BQ_EN2 low */
        ryong_gauge_sleep(); /* idle sleep: activity.c raises SLEEP right before sys_poweroff() */
    }
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(ryong_gauge_sleep, gauge_sleep_listener);
ZMK_SUBSCRIPTION(ryong_gauge_sleep, zmk_activity_state_changed);
#else
int ryong_gauge_sleep(void) { return 0; }
#endif
