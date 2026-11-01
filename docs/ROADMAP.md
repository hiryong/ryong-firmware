# Ryong Firmware development roadmap

## Gate 0 — Foundation
- [x] Private GitHub repository connected and accessible.
- [x] Product scope fixed: maker-owned keyboards, non-split, Ryong60 first.
- [x] Host-side C prototype and unit tests authored.
- [ ] Code and CI tested from a clean GitHub checkout.

## Gate 1 — Dynamic combo
- [ ] Confirm external Zephyr/ZMK module integration on a pinned upstream version.
- [ ] Obtain and verify the exact existing Ryong60 board source; DO NOT invent pin maps.
- [ ] Key-event interception and normal-key suppression/release are correct.
- [ ] Combo timeout, overlapping combos, Hold-Tap ordering and layer interactions tested.
- [ ] USB runtime combo update works without recompilation.
- [ ] Persistent storage survives power loss without corruption.
- [ ] Zephyr/ZMK firmware builds successfully.
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
**No confirmed ZMK/Zephyr build, physical keyboard flashing, live behavior test, or production-ready website/DFU.**

## Next task
Inspect upstream ZMK's current combo and behavior extension APIs and prototype the first live event integration without making unfounded hardware claims.

## Existing Keys · ryong baseline (mandatory)
- [x] Owner confirmed the existing production app already works with Studio and a separate Firmware tab.
- [ ] Obtain authorized GitHub access to `hiryong/keys-ryong`.
- [ ] Identify deployed version, record commit and create immutable baseline snapshot/tag.
- [ ] Create isolated staging development branch/copy; no production changes.
- [ ] Map existing Studio RPC, firmware tab, settings history and UI behavior.
- [ ] Add dynamic combo/macro features behind a disabled-by-default feature flag.
- [ ] Regression test unchanged production behavior and new feature side by side.
