# Ryong Firmware roadmap

## Protected baseline

Never write to hiryong/keys-ryong or deploy keys.ryong.com. Work only in
hiryong/ryong-firmware, dev/keys-ryong-runtime. Preserve all 298 baseline blobs
under apps/keys-ryong; edit the independent apps/keys-ryong-runtime copy.
Production already fully supports the owner's BT60 v2. BT60 is the actual
development fixture while Ryong60 hardware is unavailable.

## Implemented development software

- [x] GCC/Clang host core and build/security regression checks.
- [x] Original app copy, immutable source hash verification and independent build.
- [x] Pinned combo/macro/Tap Dance modules and secured custom RPC registrations.
- [x] Selected, hardened MIT Hold-Tap port with stable explicit storage slots.
- [x] Independent BT60 and Ryong60 baseline/runtime ZMK compilation.
- [x] Compatible custom Studio client on the original shared connection.
- [x] Reuse existing combo, macro, Tap Dance and Hold-Tap option editors.
- [x] Read/edit/save/readback with bounds, unlock, stale-state and concurrency checks.
- [x] Symbolic combo -> dance -> macro references and reference-aware macro rename.
- [x] Semantic dynamic backup import/export and interrupted-save recovery review.
- [x] Browser-storage offline preview; USB/BLE transports disabled in that build.
- [x] Separate firmware-update explanation; existing Firmware tab preserved.

## Automated verification

- [x] Core tests and 5 Python/C isolation, security and settings-store tests.
- [x] Model/service restart, lock, stale-state, journal failure and concurrency cases.
- [x] Macro rename/delete: 20 interruption/ACK-loss points.
- [x] Cross-feature links and 50 modeled save/ACK-loss scenarios.
- [x] Existing editor browser and direct file:// preview checks, including
  Tap Dance actions, Hold-Tap values, dynamic backup download/import and reload.
- [x] Final 12 native snapshots (5 combo, 2 macro, 2 Tap Dance, 3 Hold-Tap): passed in run 41384769725.

## Physical verification and migration remain open

- [ ] Confirm actual BT60 revision, bootloader and known-good restoration image.
- [ ] Prove physical bootloader entry even when application firmware is unresponsive.
- [ ] Test original SETTINGS_TABLE -> runtime CRC16 keymap migration and rollback.
- [ ] Preserve BLE bonds through the actual upgrade.
- [ ] USB/BLE runtime RPC and firmware-side locked-write enforcement.
- [ ] Reboot persistence, interrupted flash, concurrent playback/editing and key release.
- [ ] Typing, USB HID, sleep/wake and power regression.
- [ ] Resolve separate Ryong60 DCDC/LDO source/hardware discrepancy.

## Product release gates (closed)

- [ ] Versioned storage schema and tested downgrade policy.
- [ ] Board/model identity and signed update validation.
- [ ] User-friendly firmware update transport and practical emergency recovery.
- [ ] Independent official-ZMK comparison, staging and production sign-off.

Standard Studio already provides keymap/layer editing. Hold-Tap edits existing
mt/lt timing/flavor; arbitrary new child-behavior types are outside this increment.
Tap Dance is bounded to three actions and one shared interval. Whole-profile
storage is not atomic across modules. No installable firmware is distributed,
no physical test is requested, and no production deployment is authorized.

See RUNTIME_INTEGRATION.md for exact source/run evidence and
FIRMWARE_UPDATES.ko.md for the Korean update/recovery guide.

## Per-host Apple layout (new request)

- [x] Host-only policy prototype and tests: Apple vs Windows-standard fallback,
  per-profile separation, manual override, re-pair reset and held-key latching.
- [ ] Pin/audit the external OS detector, debounce live BLE guesses and integrate
  the actual ZMK binding/endpoint adapter.
- [ ] Versioned settings, secured RPC, profile UI and backup integration.
- [ ] BT60 firmware/native-event and real Mac/iOS/Windows verification.

See HOST_OS_LAYOUT.ko.md. This is not yet a working firmware feature.


## Unified workspace checkpoint — 2026-11-02

- [x] Replace detached Runtime dialog with the existing application shell and inline Keymap/Combo/Macro/Tap Dance/Hold-Tap navigation.
- [x] Keep dynamic edits mounted across navigation, guard destructive reloads and preserve review-only browser drafts across reload/disconnection.
- [x] Populate the keymap picker with saved macro/Tap Dance names and current device-assigned IDs; no manual numeric-ID transfer.
- [x] Preserve edits on Studio lock changes; disable Save while locked and freeze fields during a save.
- [x] Rebase separately committed Studio keymap changes without discarding staged dynamic edits; reject unsaved keymaps/concurrent runtime edits.
- [x] Local TypeScript, runtime models/fault tests, named-binding tests, Chromium desktop/mobile and offline file preview checks.
- [ ] Physical USB/BLE, persistence, upgrade and power validation remains open. The latest UI does not change that release status.
