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


# OS extension is opt-in. Validate and patch its read/write entry points so a
# profile slot never inherits another bond's cached detection/manual override.
os_root = root / "zmk-feature-os-detection/src"
if os_root.exists():
    pending = []
    core = os_root / "os_detection_core.c"
    text = core.read_text()
    anchor = '#include "os_detection_internal.h"'
    if text.count(anchor) != 1:
        raise SystemExit("Unexpected OS core includes")
    text = text.replace(anchor, anchor + "\n#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)\n#include <ryong/host_bond.h>\n#endif")
    anchor = "    return ble_detected[profile_index];"
    if text.count(anchor) != 1:
        raise SystemExit("Unexpected OS detection getter")
    text = text.replace(anchor, """#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)
    if (ryong_host_guard_profile(profile_index) < 0) return ZMK_OS_UNKNOWN;
    if (ryong_host_take_reset(profile_index)) ble_detected[profile_index] = ZMK_OS_UNKNOWN;
#endif
""" + anchor)
    anchor = "    if (ble_detected[profile_index] == detected) {"
    if text.count(anchor) != 1:
        raise SystemExit("Unexpected OS detection report")
    text = text.replace(anchor, """#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)
    if (ryong_host_guard_profile(profile_index) < 0) return;
    if (ryong_host_take_reset(profile_index)) ble_detected[profile_index] = ZMK_OS_UNKNOWN;
#endif
""" + anchor)
    pending.append((core, text))
    settings = os_root / "os_detection_settings.c"
    text = settings.read_text()
    anchor = '#include "os_detection_internal.h"'
    if text.count(anchor) != 1:
        raise SystemExit("Unexpected OS setting includes")
    text = text.replace(anchor, anchor + "\n#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)\n#include <ryong/host_bond.h>\n#endif")
    for signature, result in [
        ('static enum zmk_os read_setting(const char *key, uint8_t profile_index) {', 'ZMK_OS_UNKNOWN'),
        ('                         enum zmk_custom_setting_write_mode mode) {', '-EIO'),
    ]:
        if text.count(signature) != 1:
            raise SystemExit("Unexpected OS setting entry point")
        text = text.replace(signature, signature + "\n#if IS_ENABLED(CONFIG_RYONG_HOST_LAYOUT)\n    if (ryong_host_guard_profile(profile_index) < 0) return " + result + ";\n#endif")
    pending.append((settings, text))
    sources.extend(pending)

# No source is changed until every expected upstream anchor validates.
for path, text in sources:
    path.write_text(text)
    print(f"Studio unlock / OS identity guard: {path}")
