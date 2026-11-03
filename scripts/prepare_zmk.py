"""Prepare builds without modifying imported board sources."""
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
dest = Path(sys.argv[1]).resolve()
if dest.exists():
    raise SystemExit("Destination must not exist")
(dest / "config").mkdir(parents=True)
shutil.copytree(root / "hardware/ryong60", dest / "board")
shutil.copy2(root / "experiments/dya-runtime/west.yml", dest / "config/west.yml")
# Official ZMK + our vendored Studio extension instead of a third-party fork (third_party/zmk/README.md).
if "--host-layout" in sys.argv[2:]:
    # OS detection module, same pinned (vendored) copy as BT60.
    import yaml
    mp = dest / "config/west.yml"
    m = yaml.safe_load(mp.read_text())
    m["manifest"]["projects"].append({"name": "zmk-feature-os-detection", "remote": "cormoran",
                                      "revision": "3052679f645b8fc1997275c2eaa6b86bdd55ca01"})
    mp.write_text(yaml.safe_dump(m, sort_keys=False))
sys.path.insert(0, str(root / "scripts"))
import vendor_zmk
vendor_zmk.manifest(dest / "config/west.yml")

# These options have no effect with underglow disabled, but newer Kconfig
# rejects their unsatisfied dependencies. Normalize only the disposable copy.
defconfig = dest / "board/boards/ryong/ryong60/ryong60_nrf52840_zmk_defconfig"
text = defconfig.read_text()
if "CONFIG_ZMK_RGB_UNDERGLOW=n" not in text:
    raise SystemExit("Re-audit underglow settings before building")
unused = ("CONFIG_ZMK_RGB_UNDERGLOW_AUTO_OFF_USB=", "CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=")
defconfig.write_text("".join(line for line in text.splitlines(keepends=True)
                             if not line.startswith(unused)))

# Same OS-adaptive modifiers as BT60 (Mac-ordered base like Oreo): Windows hosts get Win, Alt / Alt, Menu,
# Apple hosts Option, Command / Command, Option. Fn+Tab (os layer) = the other OS's order.
if "--host-layout" in sys.argv[2:]:
    keymap = dest / "board/boards/ryong/ryong60/ryong60.keymap"
    text = keymap.read_text()
    start, end = text.index("    base {"), text.index("    os {")
    os_end = text.index("    raise {", end)
    base, os_layer = text[start:end], text[end:os_end]
    row = "&kp LCTRL &kp LALT &kp LGUI &kp SPACE &kp RGUI &kp RALT &kp RCTRL"
    os_row = "&trans &kp LGUI &kp LALT &trans &kp RALT &kp C_MENU &trans &trans"
    if base.count(row) != 1 or os_layer.count(os_row) != 1 or "&tog 1" not in text[os_end:]:
        raise SystemExit("Re-audit Ryong60 modifier positions")
    base = base.replace(row, "&kp LCTRL &ry_host LGUI LALT &ry_host LALT LGUI &kp SPACE &ry_host RALT RGUI &ry_host C_MENU RALT &kp RCTRL")
    os_layer = os_layer.replace(os_row, "&trans &ry_host LALT LGUI &ry_host LGUI LALT &trans &ry_host RGUI RALT &ry_host RALT C_MENU &trans &trans")
    keymap.write_text(text[:start] + base + os_layer + text[os_end:])
