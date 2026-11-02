"""Build isolation and fail-closed security patch regression tests."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
HANDLERS = [
    ('zmk-feature-runtime-combo', 'runtime_combo'),
    ('zmk-feature-runtime-tapdance', 'runtime_tapdance'),
    ('zmk-feature-runtime-macro', 'runtime_macro'),
    ('zmk-feature-custom-settings', 'custom_settings'),
]
OLD = '.security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,'
NEW = '.security = ZMK_STUDIO_RPC_HANDLER_SECURED,'

class BuildTools(unittest.TestCase):
    def test_isolated_copy_retains_board_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'workspace'
            subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_zmk.py'), str(dest)], check=True)
            for source in (ROOT / 'hardware/ryong60').rglob('*'):
                if source.is_file():
                    copied = dest / 'board' / source.relative_to(ROOT / 'hardware/ryong60')
                    if source.name == 'ryong60_nrf52840_zmk_defconfig':
                        expected = "".join(line for line in source.read_text().splitlines(keepends=True)
                                           if not line.startswith(("CONFIG_ZMK_RGB_UNDERGLOW_AUTO_OFF_USB=", "CONFIG_ZMK_RGB_UNDERGLOW_BRT_MAX=")))
                        self.assertEqual(expected, copied.read_text())
                    else:
                        self.assertEqual(source.read_bytes(), copied.read_bytes())
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_zmk.py'), str(dest)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_simulation_requires_hardened_metadata(self):
        spec = importlib.util.spec_from_file_location("sim_runner", ROOT / "scripts/run_module_simulations.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = "cormoran__runtime_combo, Security: Unsecured\npressed: position 4 keycode 0x70005\nother, Security: Unsecured\n"
        expected = "cormoran__runtime_combo, Security: Secured\npressed: position 4 keycode 0x70005\nother, Security: Unsecured\n"
        self.assertEqual(module.secured_snapshot(original), expected)

    def fixture(self, root, bad=False):
        paths = []
        for index, (module, name) in enumerate(HANDLERS):
            path = root / module / 'src/studio' / (name + '_handler.c')
            path.parent.mkdir(parents=True)
            path.write_text('changed upstream' if bad and index == 2 else OLD)
            paths.append(path)
        return paths

    def test_all_handlers_require_unlock(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = self.fixture(Path(temp))
            subprocess.run([sys.executable, str(ROOT / 'scripts/secure_runtime_rpc.py'), temp], check=True, capture_output=True)
            for path in paths:
                self.assertEqual(path.read_text(), NEW)

    def test_changed_upstream_fails_before_any_edit(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = self.fixture(Path(temp), bad=True)
            before = [path.read_bytes() for path in paths]
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/secure_runtime_rpc.py'), temp], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(before, [path.read_bytes() for path in paths])

if __name__ == '__main__':
    unittest.main()
