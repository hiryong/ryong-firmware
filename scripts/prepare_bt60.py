"""Prepare only the user's pinned BT60 test fixture; no Ryong60 hardware code."""
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
dest = Path(sys.argv[1]).resolve()
if dest.exists():
    raise SystemExit("Destination must not exist")
source = root / "hardware/test-fixtures/bt60-v2"
shutil.copytree(source, dest / "bt60-module")
shutil.copytree(source / "config", dest / "config")
shutil.copy2(root / "docs/build-evidence/34a0f3d-baseline-west.yml", dest / "config/west.yml")
# Owner's LED board ("Oreo"): same fixture, only its Mac-based keymap differs (variants/oreo/README.md).
VARIANT = sys.argv[sys.argv.index("--variant") + 1] if "--variant" in sys.argv else "cheeto"
if VARIANT not in ("cheeto", "oreo"):
    raise SystemExit("Unknown BT60 variant")
if VARIANT == "oreo":
    shutil.copy2(source / "variants/oreo/bt60.keymap", dest / "config/bt60.keymap")
conf = dest / "config/bt60.conf"
text = conf.read_text()
if "CONFIG_ZMK_RGB_UNDERGLOW=n" not in text:
    raise SystemExit("Re-audit underglow settings")
unused = ("CONFIG_ZMK_RGB_UNDERGLOW_AUTO_OFF_USB=", "CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=")
conf.write_text("".join(line for line in text.splitlines(keepends=True) if not line.startswith(unused)))

# Add only the pinned advanced module to the frozen dependency graph.
import yaml
manifest_path = dest / "config/west.yml"
manifest = yaml.safe_load(manifest_path.read_text())
manifest["manifest"]["projects"].append({
    "name": "zmk-feature-runtime-tapdance",
    "url": "https://github.com/cormoran/zmk-feature-runtime-tapdance",
    "revision": "3ed2c36ed94b16601eeba2ed39a27cc93e9a53ee",
})
manifest["manifest"]["projects"].append({
    "name": "zmk-feature-os-detection",
    "url": "https://github.com/cormoran/zmk-feature-os-detection",
    "revision": "3052679f645b8fc1997275c2eaa6b86bdd55ca01",
})
manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False))
# Official ZMK + our vendored Studio extension and modules; nothing from a third-party fork (third_party/zmk/README.md).
sys.path.insert(0, str(root / "scripts"))
import vendor_zmk
vendor_zmk.manifest(manifest_path)

if "--host-layout" in sys.argv[2:]:
    keymap = dest / "config/bt60.keymap"
    text = keymap.read_text()
    start = text.index("    base {")
    end = text.index("    raise {", start)
    base = text[start:end]
    if base.count("&kp LGUI") != 1 or base.count("&kp LALT") != 1:
        raise SystemExit("Re-audit BT60 base modifier positions")
    if VARIANT == "oreo":
        # Oreo's base is Mac order (Option, Command). OS-adaptive keys keep exactly that on Apple hosts
        # and give Windows hosts the standard Win, Alt: (Windows, Apple) parameters per key.
        if base.count("&kp LCTRL &kp LALT &kp LGUI") != 1:
            raise SystemExit("Re-audit Oreo base modifier positions")
        base = base.replace("&kp LCTRL &kp LALT &kp LGUI", "&kp LCTRL &ry_host LGUI LALT &ry_host LALT LGUI")
    else:
        base = base.replace("&kp LGUI", "&ry_host LGUI LALT").replace("&kp LALT", "&ry_host LALT LGUI")
    # Right of the space bar, Windows standard first: Alt, Menu → on Apple hosts Command, Option
    # (Mac order). Oreo's Mac-ordered right side maps to the same result.
    right = {"cheeto": "&kp SPACE &kp RALT &kp K_APP &kp RCTRL", "oreo": "&kp SPACE &kp RGUI &kp RALT &kp RCTRL"}[VARIANT]
    if base.count(right) != 1:
        raise SystemExit("Re-audit BT60 right modifier positions")
    base = base.replace(right, "&kp SPACE &ry_host RALT RGUI &ry_host K_APP RALT &kp RCTRL")
    # (The old "os" layer on Fn+Tab is gone: the OS-adaptive keys follow the computer.)
    keymap.write_text(text[:start] + base + text[end:])


