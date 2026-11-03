"""Copy ZMK's BLE profile scenarios into tests/ble/ryong-identities with one Bluetooth identity
per profile (CONFIG_BT_ID_MAX = profile count), so the simulation exercises per-slot addresses."""
import shutil, sys
from pathlib import Path

root = Path(sys.argv[1])
src, dst = root / "profiles", root / "ryong-identities"
if dst.exists():
    shutil.rmtree(dst)
for case in sorted(p for p in src.iterdir() if (p / "nrf52_bsim.keymap").exists()):
    out = dst / case.name
    shutil.copytree(case, out)
    conf = out / "nrf52_bsim.conf"
    extra = "CONFIG_BT_ID_MAX=5\n"
    conf.write_text((conf.read_text() + "\n" if conf.exists() else "") + extra)
    (out / "pending").touch()  # addresses differ from the upstream snapshot by design
    print("identity case:", out)
