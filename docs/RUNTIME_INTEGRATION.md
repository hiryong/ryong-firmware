# Runtime integration checkpoint — 2026-11-02

## Scope and protected sources

All changes are in hiryong/ryong-firmware, dev/keys-ryong-runtime.
hiryong/keys-ryong, keys.ryong.com and the original board repositories remain
read-only; no production deployment or original-repository Actions were triggered.
The owner confirms production Keys · ryong already fully supports BT60 v2.
That existing support is the baseline, not a feature to recreate.

apps/keys-ryong preserves 298 exact original source/assets blobs at
5e7b2239746002ec2c07faaead31b10cf3848622 (prebuilt installers excluded).
apps/baseline-manifest.json verifies them. All editable integration lives in
apps/keys-ryong-runtime. Existing Studio, Firmware, backup, login and design
remain in the original copy. A successful build does not verify OAuth login.

## Firmware and BT60 fixture

Pinned cormoran ZMK/custom Studio plus MIT runtime-combo, runtime-macro and
custom-settings modules compile for Ryong60 and independently for bt60//zmk.
This is a documented custom-fork dependency, not an upstream-only solution.
BT60 uses its own source copied from hiryong/zmk-config-bt60 at
dbf49fcdf3e5c45b0960859919b91361e33fa36f; no Ryong60 hardware/power code is reused.
The fixture manifest uses the archived fully resolved 59-project snapshot.
Original sources remain unchanged; inactive invalid underglow options are removed
only in disposable build copies.

Experiment bounds: 8 combos, 4 positions/combo, 8 macros, 256 encoded bytes/macro,
1024 shared macro bytes. These are not product capacity promises.
The fail-closed security patch changes all three custom subsystem registrations
to SECURED and enables Studio locking. Host checks and native snapshots verify
metadata; real locked/unlocked RPC enforcement remains unverified.

## Runtime editor implemented

The isolated runtime app aliases every Studio-client import to the pinned
compatible custom client at 3a759c4bd259d8d8f7c3783a9fa90a3048adfc47.
Standard Studio and custom RPC share the existing connection and call_rpc queue.
Protocol compatibility is checked by encode/decode before I/O; subsystem indices,
behavior IDs, physical position count and limits are discovered from the device.

The existing combo/macro editor and BehaviorDoc are reused in a separate runtime
panel. Read, edit, save and reload paths are implemented. Symbolic behavior
conversion preserves modifiers, layers, Bluetooth/output commands, macro text
and timing. Unchanged packed macros retain their original wire representation.
Unsupported settings, Tap Dance and Hold-Tap are explicitly rejected, never dropped.
All GitHub mutations are disabled in the runtime development copy.

Save validates bounded input, lock state, a fresh snapshot, concurrency and a
durable browser journal before writing. Macro bodies and combo records are read
back. Rename creates a spare slot, persists replacement bodies, updates/persists
combo and standard-keymap references, then deletes the old macro LAST.
Delete first removes durable references. Dirty standard keymaps are rejected.
No automatic retry follows an ambiguous write; the recovery journal is retained.
This avoids dangling references in modeled interruption cases, but the entire
profile remains a sequence of per-module writes, not an atomic transaction.
A journal exists; complete user-guided recovery is still pending.

## Offline preview

The standalone HTML reuses the real existing editor against a browser-only mock.
USB/BLE transports and GitHub writes are disabled. It saves only preview state in
browser storage. No firmware, device connection or installation is required.
The packer inlines app code/styles/assets; CI opens the actual file:// output.
It demonstrates UI and model behavior, not physical persistence or RPC compatibility.

## Verification evidence

- Ryong60 baseline/runtime compile, 7 native event snapshots and memory diagnostics:
  https://github.com/hiryong/ryong-firmware/actions/runs/41367763843
- GCC/Clang core and 4 build/security tests:
  https://github.com/hiryong/ryong-firmware/actions/runs/41367763854
- BT60 baseline/runtime compile, isolated target and dependency diagnostics:
  https://github.com/hiryong/ryong-firmware/actions/runs/41370026985
- Runtime UI combo/macro save/reload and standalone file browser verification:
  https://github.com/hiryong/ryong-firmware/actions/runs/41372225390
- Full client/model/service and browser verification, including 20 interruption/
  response-loss points for macro rename/delete, UI rename/delete/save/reload and
  standalone file:// preview:
  https://github.com/hiryong/ryong-firmware/actions/runs/41373082666
  Tested source: 604675d4f2bc9f9644552f340bfb09c07ea5cab0.
  Earlier failed browser runs were corrected test selectors, not device evidence.

Mock restart/ACK-loss tests do not establish real flash power-loss safety.
Build output is not hardware verification. No installable image is published.

## Remaining gates

1. Actual device interoperability, locked writes, reconnect, BLE authorization,
   simultaneous playback/editing and key-release behavior.
2. Real restart/interrupted persistence and guided journal recovery.
3. Original SETTINGS_TABLE behavior IDs versus runtime CRC16 IDs: migrate by
   discovered behavior names, preserve stored keymaps and BLE bonds, and verify
   rollback. Do not reset settings as a shortcut.
4. Hold-Tap/Tap Dance module integration and corresponding firmware/native tests.
5. Confirm the actual BT60 unit, known-good firmware and reliable bootloader entry
   even after an application failure before requesting physical tests.
6. Ryong60 has a separate unresolved DCDC/LDO source discrepancy; do not apply
   that board's electrical choices to BT60.

No UF2/HEX/BIN/ELF is uploaded, no physical test is requested, and no production
sign-off is claimed.
