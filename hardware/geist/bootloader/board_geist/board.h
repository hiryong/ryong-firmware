/*
 * ryong60 geist-UG4 / geist-UG4-S4 (61-key wireless GH60, IS31FL3746A + underglow, MDBT50Q-1MV2 / nRF52840)
 * Based on chcbaram's baram_nrf52_zmk board (MIT, (c) 2020 Nick Winans) and the ryong60 rev1.0 board.
 */
#ifndef _RYONG60_GEISTUG4_H
#define _RYONG60_GEISTUG4_H

#define _PINNUM(port, pin)    ((port)*32 + (pin))

// MDBT50Q VDD rail (+3V3) = nRF52840 REG0 output: write UICR.REGOUT0 = 3.3V on first boot
// (blank chip runs at 1.8V from VDDH until this is set).
#define UICR_REGOUT0_VALUE UICR_REGOUT0_VOUT_3V3

#define DEVICE_NAME           "Ryong60DFU"

/*------------------------------------------------------------------*/
/* LED
 *  Only P0.02 LED1 (red status LED, parts side, R3 to GND, active high) = U2 (MDBT50Q-1MV2) pad 11.
 *  geist-UG4 / geist-UG4-S4 pin map. The bootloader never touches P1.11 (LED_SDB, R21 pull-down),
 *  P0.08 (LED_PWR), P1.10 (UG_PWR), P1.02 (BQ_EN2 -> USB500 charging), P1.00 (SB_EN, FDC1004 supply on S4)
 *  or P0.04 / P0.06 (I2C), so all of them stay off / idle.
 *  The Ver2 (E73) bootloader must NOT be used here: its LED pin P0.04 is BMS_SCL on this board.
 *------------------------------------------------------------------*/
#define LEDS_NUMBER           1
#define LED_PRIMARY_PIN       _PINNUM(0, 2)
#define LED_STATE_ON          1

/*------------------------------------------------------------------*/
/* BUTTON
 *  No dedicated DFU button. Enter the bootloader with a double press of the reset button
 *  (SW1 / RST1 pads on P0.18 = nRESET; CONFIG_GPIO_AS_PINRESET is set in the Makefile)
 *  or from the keymap (Fn + Enter = &bootloader).
 *------------------------------------------------------------------*/

//--------------------------------------------------------------------+
// BLE OTA
//--------------------------------------------------------------------+
#define BLEDIS_MANUFACTURER  "ryong"
#define BLEDIS_MODEL         "geist"

//--------------------------------------------------------------------+
// USB  (same VID/PID as rev1.0 / baram_nrf52_zmk so existing tools and UF2 updates keep working)
//--------------------------------------------------------------------+
#define USB_DESC_VID           0x239A
#define USB_DESC_UF2_PID       0x00B3
#define USB_DESC_CDC_ONLY_PID  0x00B3

#define UF2_PRODUCT_NAME  "geist"
#define UF2_VOLUME_LABEL  "GEIST"
#define UF2_BOARD_ID      "ryong60-geistUG4-nRF52840"
#define UF2_INDEX_URL     "https://keys.ryong.com"

#endif
