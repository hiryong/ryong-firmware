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
- [x] User confirms the physical reset path works and Fn+Enter opens the bootloader drive; do not ask to repeat that confirmation.
- [ ] Obtain actual bootloader metadata and match an intact rollback image; interrupted-update recovery remains untested.
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

## OS-adaptive binding experiment

- [x] Implement opt-in ZMK physical Windows/Apple binding, endpoint fallback, debounce and exact press/release latching.
- [x] Host-test the same state source compiled into the ZMK module.
- [x] Pin external detector, secure its RPC and add a separate BT60 host-layout build variant.
- [ ] Confirm the new variant builds in Actions; re-pair identity reset and integrated OS control remain pending.

## Verified update transport checkpoint

- [x] Implement and locally test signed package/hash/model/version/UF2 range checks and exclusive-create transfer against synthetic temporary volumes.
- [x] Add separate native adapter, read-only bootloader inventory and an empty-by-default release policy.
- [x] Fix native serial short-write handling with write_all and error termination.
- [x] Separate native Mac development app builds and ad-hoc signature verification pass (run 41437820913).
- [ ] Real unit/recovery identity and complete backup/reboot/reconnect flow require hardware validation.
- [ ] No production board policy or installable firmware is enabled.

## Web update implementation checkpoint

- [x] Web-first policy; optional native fallback.
- [x] WebCrypto signature/hash and approved contiguous application-range validation.
- [x] Legacy Adafruit serial DFU/HCI codec and Web Serial transport, application-only, no retries after uncertain ACK.
- [x] Backup-before-reboot/update state machine and same-unit/build reconnection checks.
- [x] Firmware read-only identity plus separate secured two-phase bootloader bridge; real bootloader entry defaults off.
- [ ] Validate latest bridge in actual ZMK build; no actual BT60 bootloader identity/CDC/range/recovery approval exists yet.

## Recovery and layout hardening

- [x] Combined update backup download/import through the existing editors, with semantic macro/dance keymap references.
- [x] Reject changed/reused runtime action slots before named key assignment.
- [x] Verify BT60 Windows Ctrl/Win/Alt vs Apple Ctrl/Option/Command physical positions in preparation tests.
- [x] Use indexed settings access without retaining borrowed array-view pointers across other lookups.
- [ ] Real board/bootloader identification, approved recovery image, BLE bond retention and live write/power-loss tests remain open.

## Bluetooth device manager (Easy-Switch style)

- [x] Firmware module `modules/ryong-ble-profiles` (`ryong__ble_profiles`, Studio unlock required): per-slot registered/connected, user name (UTF-8, 30 bytes) bound to the bonded address, select slot, keyboard-side bond removal plus name and per-profile OS records. Peer addresses/keys never leave the device; per-boot token rejects actions on a slot re-paired meanwhile.
- [x] Host CTest (names, record codec, tokens) and actual-store shim test (flash refusal, reboot, stale purge, clearing a non-selected slot restores the selection), GCC and Clang.
- [x] BT60 host-layout and Ryong60 runtime ZMK compiles pass with the module (runs 41448465797, 41448465826 at 487ffca). Compile only.
- [x] Web "Bluetooth 기기" tab: names, state, last detected OS, manual layout, switch, remove with explicit host-side notice; hidden when firmware lacks it; no retries after a lost reply.
- [ ] Real BLE: select/clear on the system work queue, unpair while connected, re-pair on cleared slot, names across reboot and firmware update.
- [ ] Not covered: the host's own pairing entry (cannot be removed remotely); live state of hosts that are not connected.

## Virtual keyboard (design and QA without hardware)

- [x] Development copy only: simulated Ryong60 speaking real Studio framing/protobuf; every existing screen runs unchanged against it. Floating controls for unlock key, power cycle, host range, pairing, factory reset. State stays in the browser.
- [x] Node test plus local headless Chromium walkthrough of keymap, keycap view, Bluetooth devices and saving a combo to the (virtual) keyboard.
- [ ] Simulation fidelity is by protocol, not firmware: it does not validate timing, flash, BLE or power behaviour.
