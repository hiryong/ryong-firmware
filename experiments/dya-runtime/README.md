# Runtime behavior proof of concept — evaluation only

**Not a firmware release. Do not flash to a Ryong60, especially before confirming recovery and source/board revision.**

## Finding (2026-11-02)
- Official ZMK Studio: dynamic keymap/renaming layers; runtime definition of macros and combos is not supported upstream.
- MIT-licensed `cormoran/zmk-feature-runtime-combo`: slots can be created, key positions picked at runtime (not restricted to static positions), timeout/layers/bindings edited, with persisted settings and overlap resolution.
- MIT-licensed `cormoran/zmk-feature-runtime-macro`: runtime slots, key-down/up/tap/delay; persistent storage.
- Both require `cormoran/zmk`'s custom Studio RPC patch branch, **not standard upstream ZMK**. This adds vendor-branch maintenance risk and requires exhaustive ZMK Studio interop testing.
- Alternative: MIT `qtrnmr/zmk-module-runtime-config` supports hold-tap and conditional layers too, but its runtime combos advertise **fixed positions**. It may be better for subsequent features, not first-priority arbitrary combo creation.
- DYA Studio UI is AGPL-3.0; do not copy its UI into the existing Keys · ryong web app. The Ryong project can separately evaluate MIT firmware modules and write an original compatible UI adapter.
- The original Keys · ryong UI already has `ryong-behaviors` JSON model and GitHub-backed, firmware-rebuilding advanced editor. Keep it intact. A runtime communication adapter would be a new optional capability, not a replacement.

## Source baseline
The entire 26-file original firmware tree (from the user's `hiryong/zmk-config-ryong60`, verified matching key Git blob SHA values in `ryong60_rev1.zip`) is copied to `hardware/ryong60/` **inside this separate development branch**. No source repository was modified.

## Files
- `west.yml`: pinned project references for an isolated trial build.
- `ryong60-runtime.conf`: experimental Kconfig overlay. These settings have **not** been compiled.
- `hardware/ryong60/`: original source. Never change it in-place for trials; copy into a disposable build workspace.

## Next gated work
1. Prepare an isolated Zephyr workspace using the pinned manifest. Run `west update` and verify manifest/project resolution.
2. Compile the unmodified Ryong60 baseline on the pinned fork **without** runtime additions first. Verify bootloader and flash partition compatibility; do not flash.
3. Compile with the experimental Kconfig overlay and modules. Log compiler and RAM/flash results. Do not claim any build has succeeded until CI reports it.
4. Run host and simulated behavioral tests: overlapping combos, key suppression/replay, hold-tap precedence, slow release, reconnect, BLE lock, and interrupted config save.
5. Prototype Keys · ryong JSON v1 -> runtime RPC mappings in an independent app copy. Unsupported behavior types must remain in the legacy firmware-build path; never silently drop them.
6. Provide a reviewed test image and a specific non-destructive rollback method for real-board testing only after all software gates pass.

## Security and legal
- Studio RPC must require the equivalent of Studio Unlock for any editing command; reject unauthorized writes, including BLE/GATT.
- No changes to `hiryong/keys-ryong`: no tags, branches, PRs, releases, deployments, or workflow runs.
- Respect MIT copyright/notice files if actual module code is redistributed. Confirm all transitive licenses before production shipping.
- Keep pinned dependency revisions instead of floating `main`.

## Source links
- https://zmk.dev/docs/features/studio
- https://github.com/cormoran/zmk-feature-runtime-combo
- https://github.com/cormoran/zmk-feature-runtime-macro
- https://github.com/qtrnmr/zmk-module-runtime-config
