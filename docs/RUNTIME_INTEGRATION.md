# Runtime integration checkpoint — 2026-11-02

## Protected baseline

All writes for this work target only hiryong/ryong-firmware, branch
dev/keys-ryong-runtime. No production site, source web repository, or original
board repository was changed or deployed.

apps/keys-ryong is an independent source/assets copy of the original app at
5e7b2239746002ec2c07faaead31b10cf3848622. The 298 imported Git blob hashes
are recorded in apps/baseline-manifest.json and checked in CI.
Only the prebuilt Mac DMG and Windows EXE are excluded. Source, lockfile,
fonts, styling, Studio, Firmware, advanced editor, backup, auth functions and
desktop source are preserved. Building is supported; this copy has no configured
deployment or independently configured OAuth session. A build does not test login.

## Firmware experiment

The pinned manifest selects cormoran's custom-Studio ZMK fork plus MIT combo,
macro and custom-settings modules. It is not an upstream-only solution.
The top-level feature/fork commits are pinned. The fork imports Zephyr through
a maintenance-branch ref; CI captures the resolved commit graph (archived at
docs/build-evidence/34a0f3d-baseline-west.yml), but a fully
frozen transitive manifest is still required for a reproducible release.
Both comparison builds use that same pinned fork; only the runtime build enables
the feature overlay. An independent official-ZMK baseline comparison is still needed.

The imported hardware tree remains unchanged. prepare_zmk.py copies it into an
isolated workspace, then removes only two inactive underglow options from that
copy to satisfy newer Kconfig. This does not enable lighting.
The runtime overlay adds rmacro's behavior without replacing the default keymap.

Provisional experiment limits: 8 combos, 4 positions per combo, 8 macros,
256 encoded bytes per macro, 1024-byte shared macro pool.
These are experiment bounds, not a product capacity promise.

## Security

The pinned combo RPC registration is UNSECURED; unlike the macro module's
per-request checks, its write dispatcher has no unlock check. The build script
changes the registrations for combo, macro and custom-settings to SECURED.
Studio locking is explicitly enabled for the runtime board build.
The script verifies all three expected registrations before editing any file;
unexpected upstream changes fail closed. This intentionally locks reads too.

Four host tests verify the patch mechanics, required secured snapshot metadata and build isolation. Only actual RPC
locked/unlocked tests can prove end-to-end enforcement; those remain required.

## Client integration boundary

The preserved app uses standard zmk-studio-ts-client 0.0.18. Its generated
protobuf codec does not carry the fork's custom subsystem messages.
Do not cast a custom request into the old codec: it can silently omit that data.
Do not open a second serial connection to compete with the existing Studio stream.

A read-only adapter now exists at apps/keys-ryong/src/ryong/runtime/customRpc.ts.
It uses the existing call_rpc queue, resolves subsystem indices from discovery,
and only exposes discovery/catalog reads. It rejects a codec that drops custom
messages before any I/O. It is not imported by the UI and cannot save edits.
Adapter tests cover mock discovery/lock/error paths; installed-codec preflight
is also checked separately in app CI. This is not an end-to-end device test.

A candidate MIT client fork is cormoran/zmk-studio-ts-client at
3a759c4bd259d8d8f7c3783a9fa90a3048adfc47, but it has NOT been integrated or
regression tested here. A single shared connection and request serialization
must serve both standard Studio and custom RPCs.

Use the existing BehaviorDoc and editor. Negotiate subsystem identifiers rather
than hard-coding subsystem indices. Learn device limits and behavior IDs.
Macro slots are assigned by the device and must be read back, never inferred
from array order. Preserve wait/tap timing, text semantics and references.
Unsupported settings, Tap Dance and Hold-Tap must be reported explicitly;
never silently drop them.

The existing editor currently still uses its original GitHub/build workflow.
No runtime save button is enabled. No claim of working browser runtime editing
is made at this checkpoint.

## Remaining software gates

- Extend the seven passing upstream native snapshots with Ryong-specific interaction, authorization and fault-injection scenarios.
- Runtime RPC interoperability with existing Studio and the original editor.
- Locked-write rejection, disconnect/reconnect and BLE authorization.
- Concurrent edit/playback behavior and cancellation with key-release guarantees.
- Persistence across restart and interrupted saves, including macro-slot reuse.
- Profile-level consistency: upstream per-item persistence is not an atomic
  multi-combo/macro document transaction.
- CRC16 local-ID migration vs original stored keymaps and BLE bond preservation.
- Hold-Tap/Tap Dance feasibility after combo/macro support is proven.

## Hardware test gate — closed

No UF2/HEX/BIN/ELF is uploaded by validation CI, and no release is published.
CI keeps only configuration, devicetree, map, dependency and size diagnostics.

The original board Kconfig defaults BOARD_ENABLE_DCDC to y and selects
SOC_DCDC_NRF52X, while its DTS comment says to retain LDO because module
inductance is unconfirmed. Resolve this source/hardware discrepancy before
real-board testing. Do not silently choose a regulator mode.

Exact board revision, bootloader version, recoverable USB entry procedure,
known-good restoration image and storage/bond compatibility are unconfirmed.
Existing battery-polarity/USB-current audit questions also remain hardware gates.
No user flashing or physical test is requested.


## Verified CI checkpoint

- Firmware baseline + runtime compile, seven native snapshots and actual memory reports:
  https://github.com/hiryong/ryong-firmware/actions/runs/41367763843
- GCC/Clang host tests and four Python build/security regression tests:
  https://github.com/hiryong/ryong-firmware/actions/runs/41367763854
- All 298 preserved files, runtime read-adapter tests (including installed codec) and web build:
  https://github.com/hiryong/ryong-firmware/actions/runs/41367974198

The firmware CI source revision is 34a0f3da194da6b90bd6c68ef09e5f85c4867480.
The app adapter CI source revision is 81bee5aa94f4a2e03ab7cd24662d0edabdaaca43.
Subsequent checkpoint documentation does not change either tested implementation.
