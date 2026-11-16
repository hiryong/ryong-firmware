"""The release workflow's gate (owner's decision 2026-11-16): no bench-test record needed,
but only an admin build of the development branch, its own file, a known board and an nRF52840 UF2."""
import hashlib
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gate", ROOT / "scripts/firmware_release_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def uf2(count=3, family=0xADA52840, flags=0x2000, damage=None):
    out = b""
    for n in range(count):
        head = [0x0A324655, 0x9E5D5157, flags, 0x26000 + n * 256, 256, n, count, family]
        block = b"".join(x.to_bytes(4, "little") for x in head) + bytes([n % 256]) * 476 + (0x0AB16F30).to_bytes(4, "little")
        if damage == n:
            block = b"X" + block[1:]
        out += block
    return out


UF2 = uf2()
SHA = hashlib.sha256(UF2).hexdigest()


def run(**kw):
    return {"id": 7, "conclusion": "success", "path": ".github/workflows/firmware-build.yml", "event": "workflow_dispatch", "head_branch": "dev/keys-ryong-runtime", **kw}


def info(**kw):
    return {"run_id": 7, "target": "bt60", "uf2_sha256": SHA, **kw}


class Gate(unittest.TestCase):
    def check(self, channel="beta", r=None, i=None, data=UF2, rec=None, released=()):
        return gate.blockers(channel, r or run(), i or info(), data, rec, list(released))

    def test_released_without_bench_test(self):
        self.assertEqual(self.check(), [])
        self.assertEqual(self.check("stable"), [])  # stable no longer waits for beta
        self.assertEqual(self.check(i=info(target="ryong60")), [])
        # a failed record is attached but does not decide anything
        self.assertEqual(self.check(rec={"result": "fail", "tested_board": "ryong60"}), [])

    def test_board_check_stays(self):
        self.assertTrue(self.check(r=run(head_branch="other")))  # only the development branch
        self.assertTrue(self.check(data=uf2(4)))  # file differs from build-info
        self.assertTrue(self.check(r=run(conclusion="failure")))
        self.assertTrue(self.check(r=run(path=".github/workflows/zmk-validation.yml")))
        self.assertTrue(self.check(r=run(event="push")))
        self.assertTrue(self.check(i=info(run_id=8)))
        self.assertTrue(self.check(i=info(target="other")))
        self.assertTrue(self.check(released=["beta"]))
        self.assertTrue(self.check("nightly"))

    def test_uf2_must_be_for_the_nrf52840(self):
        for bad in (uf2(family=0x68ED2B88), uf2(flags=0), uf2(damage=1), UF2[:-1], b""):
            self.assertTrue(gate.uf2_problem(bad), bad[:8])
            self.assertTrue(self.check(data=bad, i=info(uf2_sha256=hashlib.sha256(bad).hexdigest())))
        self.assertIsNone(gate.uf2_problem(UF2))


if __name__ == "__main__":
    unittest.main()
