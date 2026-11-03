"""Fail closed if the pinned upstream RPC registration changes."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
handlers = [
    ("zmk-feature-runtime-combo", "src/studio/runtime_combo_handler.c"),
    ("zmk-feature-runtime-tapdance", "src/studio/runtime_tapdance_handler.c"),
    ("zmk-feature-runtime-macro", "src/studio/runtime_macro_handler.c"),
    ("zmk-feature-custom-settings", "src/studio/custom_settings_handler.c"),
]
if (root / "zmk-feature-os-detection").exists():
    handlers.append(("zmk-feature-os-detection", "src/studio/os_detection_handler.c"))
old = ".security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,"
new = ".security = ZMK_STUDIO_RPC_HANDLER_SECURED,"
# Validate every file before touching any source.
sources = []
for module, relative in handlers:
    path = root / module / relative
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Unexpected RPC registration: {path}")
    sources.append((path, text))
sources = [(path, text.replace(old, new)) for path, text in sources]


# The OS extension's per-bond reset now lives in the vendored module itself
# (os_detection_ble.c: a new pairing clears that slot's stored result and manual choice);
# it used to be text-patched in here, with flash writes inside read getters.

# No source is changed until every expected upstream anchor validates.
for path, text in sources:
    path.write_text(text)
    print(f"Studio unlock guard: {path}")
