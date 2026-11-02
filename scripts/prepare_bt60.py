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

if "--host-layout" in sys.argv[2:]:
    keymap = dest / "config/bt60.keymap"
    text = keymap.read_text()
    start = text.index("    base {")
    end = text.index("    os {", start)
    base = text[start:end]
    if base.count("&kp LGUI") != 1 or base.count("&kp LALT") != 1:
        raise SystemExit("Re-audit BT60 base modifier positions")
    base = base.replace("&kp LGUI", "&ry_host LALT LGUI").replace("&kp LALT", "&ry_host LGUI LALT")
    keymap.write_text(text[:start] + base + text[end:])


