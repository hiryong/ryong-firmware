# Runtime integration checkpoint — 2026-11-02

## Protected sources and fixture

All changes target hiryong/ryong-firmware, dev/keys-ryong-runtime.
No writes, Actions, branches, tags or deployment in hiryong/keys-ryong or the
original board repositories; keys.ryong.com remains unchanged.
Production already fully supports the owner's BT60 v2. This is the existing
baseline, not a new third-party support target.

apps/keys-ryong preserves the 298 original blobs from
5e7b2239746002ec2c07faaead31b10cf3848622 (prebuilt installers excluded).
CI verifies the hashes and builds the original app. All editable integration is
in apps/keys-ryong-runtime; its GitHub mutations are disabled. Original design,
Studio, Firmware, backup and auth sources remain intact. Builds do not verify
OAuth login or production deployment.

BT60 hardware source is an isolated copy from hiryong/zmk-config-bt60 at
dbf49fcdf3e5c45b0960859919b91361e33fa36f. Build target is bt60//zmk,
with its own board and power code. Never flash a Ryong60 image to it.

## Modules and bounds

The existing pinned cormoran custom-Studio fork and MIT combo/macro/custom-settings
modules remain. Added:
- cormoran/zmk-feature-runtime-tapdance at
  3ed2c36ed94b16601eeba2ed39a27cc93e9a53ee.
- Only the MIT hold-tap implementation from qtrnmr/zmk-module-runtime-config at
  76703f306052a69be869f55d98a518ab92efa020, under modules/ryong-holdtap.
  Other feature sources are excluded to prevent conflicts. License/provenance
  and local changes are recorded in that module.

Bounds: 8 combos, 4 positions/combo; 8 macros, 256 encoded bytes/macro and 1024
shared macro bytes; 8 Tap Dances, up to 3 actions each, 1024 shared bytes and one
global interval (1–2000ms). Hold-Tap edits existing mt/lt timing and flavor;
it does not create arbitrary hold/tap child behaviors. Nested dances are rejected.
Experiment bounds are not product capacity promises.

All four external custom subsystem registrations are patched to SECURED;
the selected hold-tap handler is secured in source. Studio locking is explicit.
The patch validates every expected registration before making changes. CI restores
cached dependency worktrees to their pinned HEAD before applying it, so cache
contents cannot bypass or accidentally duplicate the hardening.

Hold-Tap changes validate slots before narrowing integer types, validate timing
and persisted-record reads, propagate reset-write failures and preserve the
starting timing throughout each active keypress. Explicit runtime-slot values
(mt=0, lt=1) prevent devicetree enumeration from swapping NVS ownership. Duplicate
registrations fail. Its selected upstream raw NVS record still needs a product
schema migration/downgrade policy before release.

The BT60 fixture uses the archived frozen 59-project dependency graph plus the
pinned Tap Dance project. Ryong60's experiment still imports a Zephyr maintenance
ref through the pinned fork and records the resolved graph in CI. Freeze that
transitive graph and the build container before any product release. Both
comparison variants use the custom fork; official-ZMK comparison remains open.

## Runtime editor and persistence

The isolated app uses the pinned compatible client at
3a759c4bd259d8d8f7c3783a9fa90a3048adfc47 through one existing Studio connection
and call_rpc queue. Custom codec encode/decode is checked before I/O. Subsystem
indices, behavior IDs, physical key count and limits come from the device.

The original combo/macro/Tap Dance/behavior-options UI is reused. The runtime
path reads, compiles symbolic bindings, stages, saves and reads back all four
feature groups. Standard Studio already provides keymap/layer editing.
Symbolic bindings retain key modifiers, layers, Bluetooth/output commands,
macro text and timing. Unchanged packed macros preserve the original wire data.
Unsupported options are rejected rather than silently lost.

Combo -> Tap Dance -> macro links resolve names to actual assigned IDs.
New macro bodies become durable before dances/combos point at them. Updated
references and keymap bindings become durable before deleting old macro slots.
Tap Dance rename retains its ID; deleted IDs are never recycled.
Macro creation/rename needs a spare slot; unsafe slot reuse is rejected.

Save checks unlock, a fresh snapshot, bounds, concurrency and a browser journal
before device mutations. No automatic retry follows a lost ACK. Journal records
remain on errors; previous pending records are archived before another attempt.
Keymap RAM changes are discarded on failed saves when connected. Whole-profile
persistence is still a sequence of module/item writes, not one atomic transaction.

## Backup and recovery review

Dynamic backup format v2 stores the semantic editor document, behavior capabilities,
layers and physical key count; it does not depend on firmware-local numeric IDs.
Import rebases entry IDs by names and validates before displaying the document.
It does not write to the keyboard until explicit Save. A different layout or
capability set is rejected. Existing Studio keymap backup remains separate and
already restores behavior names to current local IDs.

The recovery control downloads an interrupted-save journal and can load the
before-state backup for review. It does not automatically reset or restore a
device. Reload current state first after reconnect. Journals and histories are
local to this browser; keep downloaded backups. This is a recovery aid, not
proof of real NVS power-loss recovery.

## Preview and firmware updates

The standalone HTML embeds assets and the same editor against a browser-storage
mock. USB/BLE transports and GitHub writes are disabled in that build. Direct
file:// launch is tested in Chromium. It proves UI/model behavior only.
The existing Firmware tab remains separate. A runtime development notice avoids
promising upgrade compatibility that has not been tested.
See FIRMWARE_UPDATES.ko.md for the Korean user/developer update and recovery guide.

## Verification

- BT60 baseline + four-feature runtime compile:
  https://github.com/hiryong/ryong-firmware/actions/runs/41384769747
  Source 0c1bd79a7d715584f6b0ac313763e4987d8ff033.
  Runtime static linker usage: Flash 294,164 B / 792 KiB, RAM 104,160 B / 256 KiB.
  These are not measured stack peaks.
- Ryong60 compile + 9 native combo/macro/Tap Dance snapshots:
  https://github.com/hiryong/ryong-firmware/actions/runs/41384115070
- Final explicit-slot firmware and 12 native snapshots: https://github.com/hiryong/ryong-firmware/actions/runs/41384769725
  Source 0c1bd79a7d715584f6b0ac313763e4987d8ff033.
- Final client/service/model/browser/standalone validation: https://github.com/hiryong/ryong-firmware/actions/runs/41385262556
  Source ef3c93f637cc55c2e56cc3fc4d1ce96754a171ee.
- Final GCC/Clang core and 5 Python/C build-security/store fault tests: https://github.com/hiryong/ryong-firmware/actions/runs/41384769780
  Source 0c1bd79a7d715584f6b0ac313763e4987d8ff033.

Mock service tests cover locks, stale state, invalid input, journal failure,
concurrency, restart models, macro rename/delete interruptions and cross-feature
write/ACK-loss cases. A separate C test compiles the actual hold-tap store and
injects NVS failures, corrupt/short reads and duplicate registration.
Three hold-tap native cases use unchanged expected HID snapshots from the pinned
ZMK baseline (tap, timeout hold, interrupt hold).

## Hardware and release gates remain closed

Actual USB/BLE RPC, lock enforcement, physical typing/sleep/power behavior,
restart persistence, simultaneous playback/editing and interrupted flash writes
have not been verified on a keyboard. Neither have installed BT60 identity,
known-good rollback image and physical bootloader recovery when the app is hung.
The baseline .config confirms SETTINGS_TABLE and the runtime .config confirms
CRC16 (recorded in docs/build-evidence/bt60-*-id-scheme.txt). That keymap migration and BLE bond retention
still require an upgrade/rollback test. Do not use settings reset as a shortcut.

Ryong60 has a separate unresolved DCDC/LDO source discrepancy. Do not apply
its electrical choices to BT60. No installable UF2/HEX/BIN/ELF is uploaded,
no hardware test is requested, and no signed release/browser DFU is claimed.
