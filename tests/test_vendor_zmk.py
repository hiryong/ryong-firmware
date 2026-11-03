import subprocess, sys, tempfile, unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


class VendorZmkTest(unittest.TestCase):
    def check(self, args):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "w"
            subprocess.run([sys.executable, str(ROOT / args[0]), str(dest), *args[1:]], check=True, capture_output=True)
            text = (dest / "config/west.yml").read_text()
            self.assertNotIn("github.com/cormoran", text)  # nothing fetched from the fork
            self.assertNotIn("remote: cormoran", text)
            projects = {p["name"]: p for p in yaml.safe_load(text)["manifest"]["projects"]}
            self.assertEqual(projects["zmk"]["url"], "https://github.com/zmkfirmware/zmk")
            self.assertEqual(projects["zmk"]["revision"], "ed56d81db79cf3a6e5dc02697277c0fad880ad34")
            self.assertEqual(projects["zmk-studio-messages"]["url"], "https://github.com/zmkfirmware/zmk-studio-messages")
            self.assertNotIn("remote", projects["zmk"])
            for name in ("zmk-feature-runtime-combo", "zmk-feature-runtime-macro", "zmk-feature-custom-settings"):
                self.assertTrue(projects[name]["url"].startswith("file://"), name)

    def test_ryong60_uses_official_zmk(self):
        self.check(["scripts/prepare_zmk.py"])

    def test_bt60_uses_official_zmk(self):
        self.check(["scripts/prepare_bt60.py", "--host-layout"])

    def test_patch_hashes_are_pinned(self):
        subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0,'scripts'); import vendor_zmk; vendor_zmk.check_patches()"], cwd=ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
