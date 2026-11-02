# Ryong Firmware roadmap

## Protected baseline

Never modify hiryong/keys-ryong or deploy keys.ryong.com. All development is in
hiryong/ryong-firmware, dev/keys-ryong-runtime. Preserve the 298 original blobs
under apps/keys-ryong; edit only apps/keys-ryong-runtime.
Production already fully supports the owner's BT60 v2. BT60 is the real
development fixture while Ryong60 hardware is unavailable.

## Completed software milestones

- [x] Host C core and GCC/Clang CI.
- [x] Original full app copy and exact source hash verification.
- [x] Pinned runtime combo/macro modules and secured RPC registrations.
- [x] Actual baseline/runtime ZMK compilation for Ryong60 and BT60 independently.
- [x] Seven module native event snapshots and build isolation/security checks.
- [x] Compatible custom Studio client, shared connection and bounded codecs.
- [x] Existing combo/macro editor reused in isolated runtime app.
- [x] Read/edit/save/readback implementation with optimistic state check,
  durable browser journal, reference-aware rename/delete and no blind retries.
- [x] Mock restart, lock, stale-state, concurrency and interrupted-save tests.
- [x] Real-browser editor save/rename/delete/reload tests.
- [x] Standalone browser-only HTML preview with device transports disabled.

## Next software gates

- [ ] Complete recovery UI for retained journals and partial multi-module saves.
- [ ] Migrate original SETTINGS_TABLE behavior IDs to runtime CRC16 IDs safely.
- [ ] Preserve original keymaps and BLE bonds; test rollback.
- [ ] Integrate and test Tap Dance, then evaluate dynamic Hold-Tap.
- [ ] Device/native interaction tests: overlap, layer and Hold-Tap ordering,
  cancellation and release guarantees during configuration changes.

## Physical verification (not yet done)

- [ ] Confirm BT60 unit, known-good restoration firmware and reliable physical
  bootloader entry after an application failure.
- [ ] Actual USB/BLE runtime RPC and locked-write enforcement.
- [ ] Actual reboot persistence and interrupted-flash recovery.
- [ ] Typing, BLE bonds, USB HID, sleep/wake and power regression.
- [ ] Resolve separate Ryong60 DCDC/LDO source/hardware discrepancy.

## Release gates (closed)

- [ ] Board/model checks and practical emergency recovery.
- [ ] Signed, verified firmware update pipeline.
- [ ] Settings migration, downgrade policy and staged QA.
- [ ] Independent official-ZMK baseline comparison and production sign-off.

No installable firmware is distributed. Browser/mock tests are not hardware
verification. Standard keymap editing already exists in the preserved Studio
app; a new keymap editor is not needed. No production deployment is authorized.

See RUNTIME_INTEGRATION.md for exact test runs and limitations.
