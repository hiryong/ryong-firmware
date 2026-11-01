# Architecture — Ryong Firmware v0 design

## Scope
Owner-designed, non-split keyboards. Ryong60 / nRF52840 first. **Not** a fork of ZMK. Reuse ZMK BLE, USB, power and keys. Avoid replacing existing ZMK Studio functionality.

## Boundary layers

1. **Board package** — actual DTS pinout, key matrix, hardware power/wake code and default keymap. Different product SKUs may require distinct firmware builds.
2. **Dynamic configuration core** — bounded versioned profiles, strict validation and staged commits. Current host C implementation is a prototype with no persistent storage.
3. **ZMK event integration** — future real key-position event interception and deferred normal-key handling; combos must operate before or at a coordinated stage with Hold-Tap and existing ZMK combos. Never drop/reorder key release events. An event-only pure matcher is insufficient.
4. **Persistence adapter** — future resilient dual-slot flash or appropriate Zephyr settings backend with migration, CRC, version and interrupted-write protection. Do not overwrite BLE bond storage.
5. **Settings transport** — use authenticated/unlocked USB configuration RPC first; transport protocol version and bounded messages. BLE settings follow only after authorization model and security design.
6. **Keys · ryong** — build on the *existing* application where possible. The user already has a web app; do not redesign it without first obtaining its source.
7. **Firmware update** — distinct from settings RPC. Select a bootloader and secure DFU solution only after verifying the existing installed bootloader, memory partitions and recovery affordances. Customer needs neither GitHub nor manual UF2 copying.

## Key decisions
- Hardware **and software** scope is intentionally restricted; do not implement split keyboard.
- Runtime layer/keymap assignment already exists in ZMK Studio. Focus first on dynamic combo definitions and macros.
- Do not claim arbitrary new ZMK devicetree behaviors can be instantiated at runtime: own execution engine may be required, with carefully defined interop.
- Never put ASCII/plaintext macros on unrestricted BLE config channels; enforce transport authorization.
- Configuration writes must be rate-limited and coalesced; never per-keystroke flash writes.
- Keep power/wake and physical switch behavior unchanged in first test firmware.
- Profile maxima in code are provisional and must be resized after actual RAM/flash measurements.
- Firmware update security: board ID + version + signature + atomic recovery are prerequisites, not retroactive enhancements.

## Source hardware baseline (provided ZIP)
Ryong60 reference firmware extracted from `ryong60_rev1.zip`:
- ZMK board target: `ryong60//zmk`.
- 5 ROW × 14 COL, row-to-column diode direction; 61 actual keys.
- Existing source: `firmware/boards/ryong/ryong60/` containing board DTS, pinctrl, keymap, soft-off wake definitions and power C source.
- Existing `firmware/build.yaml` uses `studio-rpc-usb-uart` snippet.
- Existing firmware tracks ZMK `main`; product releases should pin a verified upstream SHA.
- Existing UF2 bootloader may be incompatible with browser-based one-click updates. **Do not ship DFU until proven.**
- A 2026-11-01 audit noted unresolved battery reverse-polarity-plus-USB safety and USB current-budget issues; do not resolve these by firmware-only assumptions.

## Test boundaries
- Host core unit tests are necessary but **not** proof of a working keyboard.
- Gate for a user test: compiled ZMK firmware for the **exact** board, static memory checks, a known recovery method, and a signed-off risk checklist.
