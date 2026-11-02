"""Build isolation and fail-closed security patch regression tests."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HANDLERS = [
    ('zmk-feature-runtime-combo', 'runtime_combo'),
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
                    self.assertEqual(source.read_bytes(), copied.read_bytes())
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_zmk.py'), str(dest)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)

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
