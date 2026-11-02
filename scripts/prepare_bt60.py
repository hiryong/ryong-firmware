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
