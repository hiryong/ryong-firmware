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

# These options have no effect with underglow disabled, but newer Kconfig
# rejects their unsatisfied dependencies. Normalize only the disposable copy.
defconfig = dest / "board/boards/ryong/ryong60/ryong60_nrf52840_zmk_defconfig"
text = defconfig.read_text()
if "CONFIG_ZMK_RGB_UNDERGLOW=n" not in text:
    raise SystemExit("Re-audit underglow settings before building")
unused = ("CONFIG_ZMK_RGB_UNDERGLOW_AUTO_OFF_USB=", "CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=")
defconfig.write_text("".join(line for line in text.splitlines(keepends=True)
                             if not line.startswith(unused)))
