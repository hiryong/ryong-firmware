# Source ZIP inventory and hardware pins (read-only reference)

**Source:** customer-provided `ryong60_rev1.zip`, not a guessed pin map. Key hardware source is `ryong60/firmware/boards/ryong/ryong60/ryong60_nrf52840_zmk.dts`.

Rows (5): P0.13, P0.15, P0.17, P0.20, P0.22.
Columns (14): P0.06, P0.07, P0.08, P0.12, P0.24, P1.13, P1.11, P1.10, P1.09, P1.06, P1.04, P1.02, P1.00, P0.31.
Direction: `row2col`.
PWM backlight: P0.03, 8 kHz in source DTS.
Wake candidate: Fn position ROW4 COL13 (P0.22 / P0.31).
ZMK board ID: `ryong60//zmk`, `CONFIG_ZMK_STUDIO=y`, USB-UART Studio RPC build snippet.

Keymap physical positions in legacy ZMK source:
row counts: 14 + 14 + 13 + 12 + 8 = 61.

**IMPORTANT:** This file documents *source-reported* values; independent PCB-to-pad auditing found no obvious mismatch in an earlier report, but the actual firmware has not been built and verified on a board in this repository.

## Firmware import
The complete imported board module now exists at hardware/ryong60, with original notices preserved. Actual baseline and runtime builds have passed. Source verification and compilation do not establish compatibility with an unverified physical PCB or installed bootloader.

## Hardware safety
The original design audit raised two blockers for prototype ordering: (1) wrong battery polarity when USB is attached and physical switch ON; (2) USB current allocation with LEDs and charging simultaneously. Correct physical electrical design before manufacturing; a keyboard firmware change cannot guarantee this.

