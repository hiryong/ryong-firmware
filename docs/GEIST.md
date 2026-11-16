# geist (2026-11-14) — replaces the ryong60 target

The site's 60% target is now **geist**: the geist rev 1.0 PCB (S4 order: MDBT50Q-1MV2, IS31FL3746A per-key
LEDs, 14 SK6812 underglow, FDC1004 hand-proximity "smart backlight", MAX17048 fuel gauge, BQ24075 charger).
The old `hardware/ryong60` (rev1.0 board, no underglow) is removed. Earlier documents that say Ryong60
describe that old board and are kept as history.

## What changed
- `hardware/geist/`: the geist board module (Zephyr board `geist//zmk`), from the S4 order package.
  Bluetooth name and USB product `geist`. Bootloader is the geist one (drive `GEIST`, board ID
  `ryong60-geistUG4-nRF52840`, kept for compatibility).
- Same runtime pipeline as before (`scripts/prepare_zmk.py --host-layout`, `firmware-build.yml` target
  `geist`): runtime combos (13 defaults: Esc+Backspace = Studio unlock, number + key below = F1–F12),
  runtime macros / tap dance / hold-tap, OS-adaptive bottom-row keys, Bluetooth slots (`&bt_slot`),
  keyboard-side settings, Shift+Backspace = Delete, no os layer.
- geist extras kept: smart backlight (`&sbl`, Fn+V/B/N), per-key LED budget, underglow low-battery guard.
- Underglow "only on USB power" is applied by `ryong-runtime-settings` (ZMK's own `*_AUTO_OFF_USB` is off).
  Underglow starts unused until turned on in the site's keyboard settings (module default).
- Bluetooth slot light: ZMK's indicator (`ble_indicator.c`) is shown on the key(s) bound to the active
  slot (`&bt_slot N`, `&bt BT_SEL N`, or a `BT_Profile<N>` macro) instead of the whole backlight
  (`hardware/geist/boards/ryong/geist/ryong_slot_indicate.c`, linker wrap of `zmk_backlight_indicate`).
  Site brightness 1–100 maps to one key at 8–100. With no slot key in the keymap the whole backlight is used.
- `ryong-runtime-settings`: `CONFIG_RYONG_RUNTIME_SETTINGS_UNDERGLOW_DEFAULT_ON` (default n) for a
  first-board check image only.

## Verified / not verified
- Compiles (Zephyr SDK 0.16.8, official ZMK ed56d81 + vendored patches). Host tests pass. Web app type-check
  and build pass; browser tests virtual-e2e 37/37, admin-ui 13/13, board3d pass. `runtime-ui.test.mjs`
  times out at the same step on the unchanged branch too (not caused by this change).
- Runtime combos, OS-adaptive keys and Shift+Backspace = Delete were already checked on the BT60 V2 (owner, 2026-11-14); same modules here.
- **No geist board yet.** New on geist and not yet seen on hardware: the slot light on the slot key, and everything board-specific. Physical checks: first-board checklist in the order package.
- `public/catalog.json` "Make it yours" template still points at `hiryong/zmk-config-ryong60` (an
  external repository, not changed here); it builds the old board and must be replaced before offering it.
- `public/board3d/geist` is the previous board3d data renamed; regenerate it from the S4 package
  (`tools/board3d`) when convenient.
