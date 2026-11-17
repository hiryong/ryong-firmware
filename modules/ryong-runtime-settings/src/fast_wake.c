/*
 * Waking from deep sleep restarts the keyboard through its UF2 bootloader. Adafruit nRF52
 * bootloaders older than 0.6.3 (BT60 V2 ships 0.4.0) wait 500 ms on every start so a second tap of
 * reset can open the update drive; later ones wait only after the reset button.
 * The bootloader starts the firmware at once when its RAM word at 0x20007F7C holds the "start the
 * application" mark (0x4ee5677e, DFU_DBL_RESET_APP), and it clears the word right after reading it.
 * So the mark is written just before power-off, with that 4 KB RAM section kept through the off state
 * (about 30 nA).
 *
 * This replaces Zephyr's z_sys_poweroff() for nRF52 (soc/nordic/common/poweroff.c), which turns
 * off retention for all RAM first and would lose the mark. Same steps otherwise.
 * Reset-button behaviour: from deep sleep, the first tap starts the keyboard; a double tap after
 * that opens the drive as before.
 */
#include <zephyr/kernel.h>
#include <zephyr/toolchain.h>
#include <hal/nrf_power.h>

#define DBL_RESET_MEM ((volatile uint32_t *)0x20007F7CUL)
#define DBL_RESET_APP 0x4ee5677eUL
/* RAM[3] covers 0x20006000-0x20007FFF; section 1 is 0x20007000-0x20007FFF */
#define MARK_BLOCK 3
#define MARK_SECTION_RETENTION POWER_RAM_POWERSET_S1RETENTION_Msk

void __wrap_z_sys_poweroff(void) {
    for (int n = 0; n < (int)ARRAY_SIZE(NRF_POWER->RAM); n++) {
        NRF_POWER->RAM[n].POWERCLR = 0xFFFF0000UL; /* retention bits S0..S15 off */
    }
    NRF_POWER->RAM[MARK_BLOCK].POWERSET = MARK_SECTION_RETENTION;
    *DBL_RESET_MEM = DBL_RESET_APP;
    __DSB();
    nrf_power_system_off(NRF_POWER);
    CODE_UNREACHABLE;
}
