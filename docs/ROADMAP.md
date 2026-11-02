## CRITICAL — absolute read-only source repository
The existing production app at `hiryong/keys-ryong` is **NEVER to be modified** by this project. The owner explicitly forbids all writes, including file edits, pull requests, branches, tags, actions, releases, settings, and deployments. The GitHub API may grant write permission, but that is NOT authorization. Read only from pinned commit `5e7b2239746002ec2c07faaead31b10cf3848622`. All development and copies must live in `hiryong/ryong-firmware` or another independently authorized repository. Never target keys.ryong.com production deployment.

# Ryong Firmware development roadmap

## Gate 0 — Foundation
- [x] Private GitHub repository connected and accessible.
- [x] Product scope fixed: maker-owned keyboards, non-split, Ryong60 first.
- [x] Host-side C prototype and unit tests authored.
- [x] Host code and CI tested from a clean GitHub checkout (GCC and Clang).

## Gate 1 — Dynamic combo
- [x] Compile external modules on a pinned custom-Studio ZMK fork (not upstream-only).
- [x] Import the existing Ryong60 board source; physical-board revision verification remains open.
- [ ] Key-event interception and normal-key suppression/release are correct.
- [ ] Combo timeout, overlapping combos, Hold-Tap ordering and layer interactions tested.
- [ ] USB runtime combo update works without recompilation.
- [ ] Persistent storage survives power loss without corruption.
- [x] Actual Ryong60 baseline and runtime Zephyr/ZMK builds pass (2026-11-02).
- [ ] Actual Ryong60 typing/USB/BLE/sleep behavior verified.

## Gate 2 — More VIA-like configuration
- [ ] Runtime macros with release guarantees and bounded execution.
- [ ] Dynamic layer/keymap editing.
- [ ] Hold-Tap / Tap Dance property editing, subject to feasibility.
- [ ] Versioned protocol, configuration migration and backup/restore.
- [ ] Keys · ryong web application using secure supported browser transports.

## Gate 3 — Product update pipeline
- [ ] Board/model identity enforced.
- [ ] Bootloader and DFU path selected based on actual hardware.
- [ ] Signed firmware and trusted update validation.
- [ ] Recoverable interrupted updates and documented emergency recovery.
- [ ] User settings and BLE bonds retained when supported, or safely migrated.
- [ ] Release QA, reproducible artifacts, staged rollout and downgrade policy.

## Verification status
Host C unit tests passed in ChatGPT working container (2026-11-02).
**Actual Ryong60 baseline/runtime builds and independent web-app builds have passed. No physical keyboard flashing, live runtime editor, power-loss validation, or production-ready DFU.**

## Next task
Complete native event tests, then integrate a compatible custom RPC client into the isolated original editor. See RUNTIME_INTEGRATION.md for blocking compatibility and hardware gates.

## Existing Keys · ryong baseline (mandatory)
- [x] Owner confirmed the existing production app already works with Studio and a separate Firmware tab.
- [x] Confirm read-only GitHub access to `hiryong/keys-ryong`.
- [x] Record source commit SHA inside this separate repository; [ ] independently identify the deployed version. Never tag the source.
- [x] Create isolated development branch and partial source reference copy in `ryong-firmware`; [x] obtain full independent buildable source/assets working copy (prebuilt installers excluded).
- [ ] Map existing Studio RPC, firmware tab, settings history and UI behavior.
- [ ] Add dynamic combo/macro features behind a disabled-by-default feature flag.
- [ ] Regression test unchanged production behavior and new feature side by side.


## Latest evidence

- Host tests: https://github.com/hiryong/ryong-firmware/actions/runs/41367763854
- Original app source hash check + web build: https://github.com/hiryong/ryong-firmware/actions/runs/41367974198
- Actual baseline/runtime Ryong60 compile: https://github.com/hiryong/ryong-firmware/actions/runs/41367763843
- Baseline: Flash 248,888 B, RAM 72,274 B. Runtime: Flash 286,128 B, RAM 100,292 B. These are linker/static usage values, not measured stack peaks.
- Seven pinned native event snapshots pass (5 combo, 2 macro), with hardened RPC metadata required. Actual rom_report/ram_report diagnostics also pass. These do not establish physical performance or interrupted-save safety.
