# Ryong Firmware · Keys · ryong

Private development repository for owner-designed **non-split keyboards**, starting with **Ryong60**.

## Objective

Build a VIA-like runtime configuration experience on top of **ZMK**, retaining its BLE / USB HID and power-management foundations.

- Runtime modification of keymaps, layers, combos, macros, and advanced key behaviors **without reflashing**.
- User settings persist across reboots and major firmware updates.
- Each owner-designed keyboard receives a board-specific, factory-installed firmware and bootloader.
- Major firmware updates are provided by the **Keys · ryong** website through a distinct, verified update workflow.
- Customers never need to build firmware, open GitHub, drag UF2 files, or use SWD.

**Deliberately excluded:** split-keyboard support, third-party keyboard support, broad MCU portability. Prioritize Ryong60 and future boards built by the same maker.

## Engineering status

**Developer prototype only — not a keyboard-installable firmware.**

Host-testable C prototype covers bounded profile validation, RAM edit transactions and pure combo matching. It does NOT implement live ZMK key-event interception, HID output, flash persistence, USB settings RPC or browser firmware updating.

Actual Ryong60 and BT60 baseline/runtime builds pass. The isolated original editor now supports runtime combo, macro, Tap Dance and existing Hold-Tap timing configuration, with dynamic backup/recovery review. Browser/mock tests and native snapshots pass; live-device persistence, upgrade migration and recovery are still unverified. No installable development image is distributed. See the [integration checkpoint](docs/RUNTIME_INTEGRATION.md) and [Korean update guide](docs/FIRMWARE_UPDATES.ko.md) for evidence and limits.

See [AGENTS.md](AGENTS.md), [docs/ROADMAP.md](docs/ROADMAP.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Do not claim a ZMK/Zephyr build or hardware test unless one has actually passed.

## Host tests

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

### Hardware

Ryong60 reference design includes nRF52840, 61 switches, 5 row × 14 column matrix, USB-C, BLE and white key backlight. **Do not guess actual GPIO numbers** from the counts here; obtain verified original board source before a device build.

This repository is private, but external dependencies and their licenses must still be respected.

## Protect the existing web application
**Keys · ryong is already working.** It has ZMK Studio-based live configuration and a separate Firmware tab. Do **not** replace it. Integrate new runtime behavior editing into an isolated development copy of `hiryong/keys-ryong` using a pinned immutable source baseline recorded in this repository and mapping the deployed version. Never create a tag or any other write in the original repository. No production deployments without user approval.

