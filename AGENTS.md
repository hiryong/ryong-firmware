# Ryong Firmware — development instructions

## CRITICAL — absolute read-only source repository
The existing production app at `hiryong/keys-ryong` is **NEVER to be modified** by this project. The owner explicitly forbids all writes, including file edits, pull requests, branches, tags, actions, releases, settings, and deployments. The GitHub API may grant write permission, but that is NOT authorization. Read only from pinned commit `5e7b2239746002ec2c07faaead31b10cf3848622`. All development and copies must live in `hiryong/ryong-firmware` or another independently authorized repository. Never target keys.ryong.com production deployment.


## Product scope
Build the firmware and settings site for user-designed, non-split keyboards. First target Ryong60 (nRF52840), later the maker's own layouts only. Use ZMK BLE, USB, sleep and power management rather than rewriting them.

## Non-negotiable rules
- Dynamic keymap, combo, macro and advanced-behavior editing must not require firmware rebuild or reflash.
- Standard user configuration and device firmware update must be separate operations.
- Factory firmware and bootloader are preflashed and quality checked. Do not ask customers to install bootloaders, copy UF2 files, use GitHub, or handle SWD.
- Prefer a ZMK/Zephyr out-of-tree module. Do not fork upstream ZMK without a documented technical need.
- No invented board pin assignments, diode direction, reset/wake behavior or flash partitions. Import genuine Ryong60 PCB/board source and verify it.
- Never claim tested physical hardware or ZMK compatibility on the strength of PC unit tests alone.
- Protect existing BLE bonds and user configuration through upgrades, or explain planned migration explicitly.
- Bounded configuration sizes, validation, interrupted-write recovery and concurrency tests are mandatory.
- Avoid dynamic allocation on hot key paths and avoid flash writes on individual keystrokes.
- Customer-facing firmware release needs board identity checks, signature verification and a practical recovery path. Do not pretend ordinary UF2 MSC alone enables automatic browser flashing.
- No split keyboard support, third-party keyboards or broad MCU compatibility work in phase one.
- NEVER flash hardware or distribute an installable firmware image without explicit validation of its real board.

## Process
1. Read README and docs before changing code.
2. Run the available CMake/CTest host tests and report them accurately.
3. Investigate ZMK's external module, Studio RPC, behaviors, combos, and settings before choosing an integration mechanism.
4. Implement the smallest testable increment; do not build the polished UI first.
5. Update roadmap and record what is and is not verified after each milestone.
6. Always distinguish host C tests, actual Zephyr/ZMK builds, hardware tests, and production sign-off.

## Existing Keys · ryong web app — STRICT BASELINE PRESERVATION
The owner has an already-working customer-facing Keys · ryong website, built using Claude. Its working flows include ZMK Studio-based live keymap editing and a **separate Firmware tab**. This is the **known-good baseline**, not a rewrite target.
- NEVER modify or deploy over the production website during development.
- Do not rebuild the existing design or duplicate its working Studio/Firmware features.
- Source access is now available for READ ONLY inspection. The initial source subset is copied under `reference/keys-ryong/` on the `dev/keys-ryong-runtime` branch. Never write to the original.
- Record the original commit SHA in this repository only; never create tags, branches, or snapshots inside the original repository. Independently verify production deployment revision before staging.
- Implement additions only on a separate dev branch/copy of the app; use a staging site distinct from production.
- Preserve current styling, routes, authentication, Studio unlock, 5-change history and separate Firmware tab. Regression-test them before proposing any merge.
- Do not deploy or change the original production site. Future deployment plans require a separate, explicit decision outside the current project scope.
- Having `ryong-firmware` access does not grant `keys-ryong` access. If the app repo is private, GitHub App installation may need explicit additional repository permission.

## User-authorized BT60 v2 development fixture
On 2026-11-02 the user clarified that their BT60 v2 is used for all ZMK physical tests while Ryong60 completion is unknown. Support this as a development fixture only, not a third-party product-support expansion. Read hiryong/zmk-config-bt60 at pinned commit dbf49fcdf3e5c45b0960859919b91361e33fa36f; never write or trigger Actions there. Keep all fixture copies/builds in ryong-firmware. Build bt60//zmk independently; NEVER flash a Ryong60 image to BT60 or reuse its hardware/power code. Ryong60 electrical questions do not block software testing on BT60, but the BT60 unit, known-good firmware and recovery path must still be verified before requesting a physical test.
