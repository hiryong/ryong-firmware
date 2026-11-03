# Vendored ZMK Studio extension and feature modules

Our firmware is **official ZMK** plus these two patches. We no longer fetch the cormoran fork, so
its future changes (or its removal) cannot reach our builds. `scripts/vendor_zmk.py` points the
west manifest at the official repositories and applies the patches after `west update`.

| Patch | Applies to (official) | Taken from | What it adds |
|---|---|---|---|
| `zmk-custom-studio.patch` | zmkfirmware/zmk `ed56d81` (main, 2026-05-26) | cormoran/zmk `1fc72aa` (branch `main+custom-studio-protocol`), minus `app/west.yml` and `docs/` | Studio custom subsystems (`custom_subsystem.c`, `zmk/studio/custom.h`, linker section), RPC TX back-pressure and deadlock fixes, BLE advertising while Studio is unlocked, split relay events (split boards only; unused by BT60/Ryong60) |
| `zmk-studio-messages-custom.patch` | zmkfirmware/zmk-studio-messages `6cb4c28` | cormoran/zmk-studio-messages `89b81d2` | `custom.proto` (list/call custom subsystems), its field in `studio.proto` |

Checked 2026-11-03: base + patches is identical to the cormoran trees we built on before
(0 differing lines), so firmware behaviour is unchanged. License: MIT (The ZMK Contributors).

Review notes: the extension only routes Studio RPC calls to modules that register a custom
subsystem; each module declares whether it needs Studio unlocked, and
`scripts/secure_runtime_rpc.py` forces every one we ship to require it. No other behaviour
changes outside Studio, BLE advertising and split transport.

## Ryong additions to the patch

`zmk-custom-studio.patch` also carries one Ryong change (base.json `ryong_changes`): **Studio RPC
over a vendor HID collection** (usage page 0xFF5A, report 0x10, 32 bytes each way, byte 0 = length).
Browsers' WebHID can open it while the keyboard stays connected over Bluetooth or USB, which Web
Bluetooth cannot on Windows/macOS. Files: `include/zmk/hid.h` (descriptor), `src/hog.c` (BLE
report characteristics, appended last), `src/usb_hid.c` (SET_REPORT, 64-byte interrupt endpoint),
`src/studio/hid_rpc_transport.c`, `src/studio/rpc.c` (`zmk_rpc_note_rx`: every transport keeps receiving and the one a request arrived on answers, so web HID, Web Bluetooth, the desktop app and USB serial work one after another without reconnecting). Hosts must re-read
the HID descriptor once: remove the keyboard from the computer's Bluetooth list and pair again.

## Feature modules (`third_party/zmk-modules/`)

Copied once, at the commits we had reviewed and pinned, then owned here. Builds turn each into a
throwaway local git repo (`scripts/vendor_zmk.py`), so west finds them as usual and nothing is
fetched from GitHub for them. `base.json` holds a hash of every file; editing one requires
updating the hash on purpose. Removed from the copies: CI/devcontainer/agent config and the
`web/` browser UIs (keysbeta has its own). License: MIT, kept in each folder.

| Module | Copied from |
|---|---|
| zmk-feature-runtime-combo | cormoran `d9490e7` |
| zmk-feature-runtime-macro | cormoran `3853096` |
| zmk-feature-runtime-tapdance | cormoran `3ed2c36` |
| zmk-feature-os-detection | cormoran `3052679` |
| zmk-feature-custom-settings | cormoran `c6a7fef` |

After this, the only external sources are the official zmkfirmware and zephyrproject-rtos
repositories at pinned commits.

## Moving to a new official ZMK release

Nothing is installed on its own. A weekly scheduled check (Claude) looks for a new official
release; when one appears it ports the patches and modules onto it on a separate branch, decides
where the release now covers something our modules do (and drops or keeps ours accordingly),
builds every board, and reports the result on keysbeta.ryong.com/admin (`zmk-update.json` in the
firmware-registry branch). Adopting it is then the usual flow: bench-test, record, release.
