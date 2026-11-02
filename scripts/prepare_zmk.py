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
