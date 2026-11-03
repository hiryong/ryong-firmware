"""Host C unit tests of keyboard-side logic (no Zephyr): runtime settings record, USB name."""
from pathlib import Path
import subprocess, tempfile, unittest

ROOT = Path(__file__).resolve().parents[1]
INC = ROOT / "modules/ryong-runtime-settings/include"
SRC = ROOT / "modules/ryong-runtime-settings/src"


class CUnits(unittest.TestCase):
    def run_c(self, test, *srcs):
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "t"
            subprocess.run(["gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", f"-I{INC}", "-o", str(exe), str(ROOT / "tests" / test), *map(str, srcs)], check=True)
            out = subprocess.run([str(exe)], check=True, capture_output=True, text=True).stdout
            self.assertIn("ok", out)

    def test_settings_core(self):
        self.run_c("test_runtime_settings_core.c", SRC / "settings_core.c")

    def test_usb_name(self):
        self.run_c("test_usb_name.c", SRC / "usb_name_core.c")


if __name__ == "__main__":
    unittest.main()
