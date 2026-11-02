# Keys · ryong: protected original source

## Absolute no-write policy
`hiryong/keys-ryong` is a working production site. **NEVER mutate it, even to create a branch or a tag.** No file, PR, issue, workflow, release, setting, or deployment changes in the source repository. Only read from an immutable commit SHA. GitHub connector write permission is not authorization.

## Observed baseline
- Source repository: `hiryong/keys-ryong` (private)
- Reference commit: `5e7b2239746002ec2c07faaead31b10cf3848622`
- Original source branch: `main`
- Live Cloudflare deployment commit: **not confirmed** (may differ).
- Original includes daily upstream sync and Cloudflare Pages automatic deployment: **no writes or action triggers**.
- Existing site: official ZMK Studio based editor, separately labeled Firmware tab, GitHub-based advanced combo/macro/tap dance editor, backup and desktop Bluetooth bridge.

## Copied reference (this separate repository only)
`reference/keys-ryong/` contains **12 exact text files** from the reference commit, including core web UI entrypoints, the advanced behavior model/editor, API integration context, original license and notice.
It is a **partial immutable reference copy, NOT a runnable full website**. A separate complete buildable source/assets copy now exists at apps/keys-ryong; see apps/README.md and apps/baseline-manifest.json. The independent copy includes Studio, backend source, assets, config and lockfile; prebuilt DMG/EXE installers are intentionally excluded.
Do not deploy or overwrite keys.ryong.com from this repository. All additions should be developed separately and feature gated.

## Target behavior
Keep current Studio and Firmware experiences unchanged. Reuse existing `ryong-behaviors` version 1 shape, but offer direct runtime application for Ryong-equipped keyboards after capability negotiation. Existing devices retain GitHub-commit-plus-firmware-build behavior.

## Validation gate
Before staging UI changes, obtain a full independent development checkout (never mutate original); perform baseline build and UI regression tests. Customer production deployment is forbidden without renewed explicit authorization.

