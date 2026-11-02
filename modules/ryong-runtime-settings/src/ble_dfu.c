/* SPDX-License-Identifier: MIT */
/* Restart into the Adafruit nRF52 bootloader's Bluetooth DFU mode (GPREGRET = 0xA8).
 * The bootloader itself stays untouched, so USB/UF2 recovery remains available. */
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <hal/nrf_power.h>
#include <ryong/settings_runtime.h>
#if DT_HAS_COMPAT_STATUS_OKAY(ryong_behavior_ble_dfu)
#include <drivers/behavior.h>
#include <zmk/behavior.h>
#endif

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#define RY_DFU_MAGIC_OTA_RESET 0xA8 /* Adafruit_nRF52_Bootloader src/main.c */

static void reboot_work(struct k_work *work) {
    ARG_UNUSED(work);
    LOG_INF("Restarting into Bluetooth update mode");
    nrf_power_gpregret_set(NRF_POWER, 0, RY_DFU_MAGIC_OTA_RESET);
    NVIC_SystemReset();
}
static K_WORK_DELAYABLE_DEFINE(reboot, reboot_work);

int ry_rs_enter_ble_dfu(void) {
    /* Short delay so the RPC reply reaches the web app before the radio goes away. */
    k_work_schedule(&reboot, K_MSEC(300));
    return 0;
}

#if DT_HAS_COMPAT_STATUS_OKAY(ryong_behavior_ble_dfu)
#define DT_DRV_COMPAT ryong_behavior_ble_dfu
static int pressed(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    ARG_UNUSED(binding);
    ARG_UNUSED(event);
    ry_rs_enter_ble_dfu();
    return ZMK_BEHAVIOR_OPAQUE;
}
static int released(struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event) {
    ARG_UNUSED(binding);
    ARG_UNUSED(event);
    return ZMK_BEHAVIOR_OPAQUE;
}
static const struct behavior_driver_api api = {
    .binding_pressed = pressed,
    .binding_released = released,
    .locality = BEHAVIOR_LOCALITY_EVENT_SOURCE,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
    .get_parameter_metadata = zmk_behavior_get_empty_param_metadata,
#endif
};
#define BLE_DFU_INST(n)                                                                            \
    BEHAVIOR_DT_INST_DEFINE(n, NULL, NULL, NULL, NULL, POST_KERNEL,                                \
                            CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &api);
DT_INST_FOREACH_STATUS_OKAY(BLE_DFU_INST)
#endif
