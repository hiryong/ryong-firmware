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
for path, text in sources:
    path.write_text(text.replace(old, new))
    print(f"Studio unlock required: {path}")
