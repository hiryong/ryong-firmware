# OS-adaptive physical keys

MIT local module, experiment only. The audited detector is pinned to
cormoran/zmk-feature-os-detection 3052679f645b8fc1997275c2eaa6b86bdd55ca01.
Its classifiers are heuristic. USB and BLE are selected by upstream endpoint
state; USB observations are not copied to a BLE profile. Per-profile overrides
are supplied by the detector and its existing custom-settings persistence.
Its unsecured Studio handler is hardened by scripts/secure_runtime_rpc.py.

`&ry_host <Windows usage> <Apple usage>` changes only explicitly participating
physical bindings. It does not rewrite saved keymaps, macro outputs or every
HID modifier. The BT60 experiment modifies only the disposable base-layer copy:
left outer position Alt/Option, left inner position GUI/Command. Existing OS
layer and its manual bindings remain available, so users should leave that
manual layer off while evaluating automatic layout.

Unknown/non-Apple uses Windows standard. Apple observations settle for 2 seconds;
layout changes wait for tracked keys to release. Release uses the exact usage
latched at press, even when endpoint or settings change. All hot-path storage
is fixed (96 positions), with no per-key flash writes or dynamic allocation.

A private versioned owner record binds each profile's detected cache and manual
override to its actual BLE peer address. On a changed/missing owner, both values
are cleared durably before adopting the new owner. Failed writes fail closed and
keep the old owner for retry. No peer address is exposed through RPC.
Known gates: no physical verification; the new bond-reset adapter needs fault
coverage and a real unpair/re-pair test before release. Do not ship or request flashing. A successful board compile would establish API/build compatibility,
not OS classification accuracy, BLE bond continuity or release safety.
