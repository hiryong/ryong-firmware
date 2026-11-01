# Ryong Firmware — development instructions

## Product scope
Build the firmware and settings site for user-designed, non-split keyboards. First target Ryong60 (nRF52840), later the maker's own layouts only. Use ZMK BLE, USB, sleep and power management rather than rewriting them.

## Non-negotiable rules
- Dynamic keymap, combo, macro and advanced-behavior editing must not require firmware rebuild or reflash.
- Standard user configuration and device firmware update must be separate operations.
- Factory firmware and bootloader are preflashed and quality checked. Do not ask customers to install bootloaders, copy UF2 files, use GitHub, or handle SWD.
- Prefer a ZMK/Zephyr out-of-tree module. Do not fork upstream ZMK without a documented technical need.
- No invented board pin assignments, diode direction, reset/wake behavior or flash partitions. Import genuine Ryong60 PCB/board source and verify it.
- Never claim tested physical hardware or ZMK compatibility on the strength of PC unit tests alone.
- Protect existing BLE bonds and user configuration through upgrades, or explain planned migration explicitly.
- Bounded configuration sizes, validation, interrupted-write recovery and concurrency tests are mandatory.
- Avoid dynamic allocation on hot key paths and avoid flash writes on individual keystrokes.
- Customer-facing firmware release needs board identity checks, signature verification and a practical recovery path. Do not pretend ordinary UF2 MSC alone enables automatic browser flashing.
- No split keyboard support, third-party keyboards or broad MCU compatibility work in phase one.
- NEVER flash hardware or distribute an installable firmware image without explicit validation of its real board.

## Process
1. Read README and docs before changing code.
2. Run the available CMake/CTest host tests and report them accurately.
3. Investigate ZMK's external module, Studio RPC, behaviors, combos, and settings before choosing an integration mechanism.
4. Implement the smallest testable increment; do not build the polished UI first.
5. Update roadmap and record what is and is not verified after each milestone.
6. Always distinguish host C tests, actual Zephyr/ZMK builds, hardware tests, and production sign-off.
