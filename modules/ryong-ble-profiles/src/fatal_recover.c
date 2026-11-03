/* SPDX-License-Identifier: MIT */
/*
 * Crash recovery. Zephyr's default on a fatal error (a fault, a stack overflow caught by the MPU) is
 * to stop: the keyboard looks dead until its battery runs out or the reset button is pressed.
 * Here it restarts instead. If it crashes again soon after starting, three times in a row, it
 * restarts into the UF2 bootloader (the USB drive used to install firmware), so a bad build can
 * be replaced without opening the case.
 *
 * The count lives in GPREGRET2, a register kept across a restart that the UF2 bootloader does not
 * use (it uses GPREGRET). It is cleared after the keyboard has run for 30 s.
 */
#include <zephyr/kernel.h>
#include <zephyr/init.h>
#include <zephyr/fatal.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/logging/log.h>
#include <nrf.h>

LOG_MODULE_REGISTER(ryong_fatal, CONFIG_LOG_DEFAULT_LEVEL);

#define COUNT_MAGIC 0xA0u
#define COUNT_MASK 0x0Fu
#define CRASHES_BEFORE_BOOTLOADER 3
#define UF2_BOOTLOADER_MAGIC 0x57 /* what ZMK's &bootloader passes to sys_reboot on nRF52 */

static uint8_t crashes(void) {
    uint32_t v = NRF_POWER->GPREGRET2;
    return (v & ~COUNT_MASK & 0xFF) == COUNT_MAGIC ? (v & COUNT_MASK) : 0;
}

void k_sys_fatal_error_handler(unsigned int reason, const struct arch_esf *esf) {
    ARG_UNUSED(esf);
    LOG_PANIC();
    uint8_t n = crashes() + 1;
    LOG_ERR("Fatal error %u: restarting (%u in a row)", reason, n);
    if (n >= CRASHES_BEFORE_BOOTLOADER) {
        NRF_POWER->GPREGRET2 = 0;
        sys_reboot(UF2_BOOTLOADER_MAGIC);
    }
    NRF_POWER->GPREGRET2 = COUNT_MAGIC | MIN(n, COUNT_MASK);
    sys_reboot(SYS_REBOOT_COLD);
    CODE_UNREACHABLE;
}

static void healthy(struct k_work *work) {
    ARG_UNUSED(work);
    if (crashes()) {
        LOG_WRN("Running fine after %u crash restart(s)", crashes());
    }
    NRF_POWER->GPREGRET2 = 0;
}
static K_WORK_DELAYABLE_DEFINE(healthy_work, healthy);

static int fatal_recover_init(void) {
    k_work_schedule(&healthy_work, K_SECONDS(30));
    return 0;
}
SYS_INIT(fatal_recover_init, APPLICATION, CONFIG_APPLICATION_INIT_PRIORITY);
