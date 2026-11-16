/*
 * geist Ver2: IS31FL3746A driver API (beyond the generic LED API).
 * Dots are numbered 0..71 = (SW-1)*18 + (CS-1); register address = dot + 1 (pages 0 and 1).
 * LED API write_channels() writes PWM (page 0); set_brightness(dot, 0..100) writes one PWM value.
 */
#pragma once
#include <zephyr/device.h>
#include <stdbool.h>
#include <stdint.h>

#define IS31FL3746A_DOTS 72

/* page 1 scaling (dot peak current, 0..255) for dots [start, start+n) */
int is31fl3746a_write_scaling(const struct device *dev, uint8_t start, uint8_t n, const uint8_t *sl);
/* page 1 51h global current control */
int is31fl3746a_set_gcc(const struct device *dev, uint8_t gcc);
/* page 1 50h SSD: true = software shutdown (matrix blanked, registers kept) */
int is31fl3746a_blank(const struct device *dev, bool blank);
/* full re-initialisation after SDB was low or at power up (reset, configuration, de-ghost, thermal roll off) */
int is31fl3746a_configure(const struct device *dev);
/* power sequencing: on = load switch (VCC) on, wait, VIO/SDB high, configure(); off = VIO/SDB low, then VCC off.
 * Registers are lost while VCC is off, so every power-on reconfigures the chip. */
int is31fl3746a_power(const struct device *dev, bool on);
/* before pulling SDB low: de-ghost resistors off (datasheet: saves about 1 uA in hardware shutdown) */
int is31fl3746a_prepare_shutdown(const struct device *dev);
/* open detection (datasheet "Open/short detect"): bit (dot) set in open[] when that dot reads open.
 * Only dots whose scaling is non-zero are refreshed by the chip, so the caller lights them first. */
int is31fl3746a_detect_open(const struct device *dev, uint8_t open[IS31FL3746A_DOTS / 8]);
