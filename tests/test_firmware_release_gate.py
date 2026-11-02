"""The release workflow's gate: only the bench-tested file, on its own board, with every required check."""
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gate", ROOT / "scripts/firmware_release_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
CHECKLIST = json.loads((ROOT / "apps/keys-ryong-runtime/admin-functions/_lib/checklist.json").read_text())
UF2 = b"UF2\n" * 64
SHA = hashlib.sha256(UF2).hexdigest()
REQUIRED = {i["id"]: "pass" for i in CHECKLIST["items"] if i["required"]}
ALL = {i["id"]: "pass" for i in CHECKLIST["items"]}


def run(**kw):
    return {"id": 7, "conclusion": "success", "path": ".github/workflows/firmware-build.yml", "event": "workflow_dispatch", **kw}


def info(**kw):
    return {"run_id": 7, "target": "bt60", "uf2_sha256": SHA, **kw}


def record(items=None, **kw):
    return {"run_id": 7, "uf2_sha256": SHA, "tested_board": "bt60", "items": REQUIRED if items is None else items, **kw}


class Gate(unittest.TestCase):
    def check(self, channel="beta", r=None, i=None, data=UF2, rec="default", released=()):
        return gate.blockers(channel, r or run(), i or info(), data, record() if rec == "default" else rec, list(released), CHECKLIST)

    def test_beta_allowed_when_required_pass(self):
        self.assertEqual(self.check(), [])

    def test_refusals(self):
        self.assertTrue(self.check(rec=None))
        self.assertTrue(self.check(data=b"other"))  # file changed after the test
        self.assertTrue(self.check(rec=record(uf2_sha256="0" * 64)))
        self.assertTrue(self.check(rec=record(tested_board="ryong60")))
        self.assertTrue(self.check(rec=record(items={**REQUIRED, "recovery": "skip"})))
        self.assertTrue(self.check(rec=record(items={**ALL, "battery": "fail"})))
        self.assertTrue(self.check(r=run(conclusion="failure")))
        self.assertTrue(self.check(r=run(path=".github/workflows/zmk-validation.yml")))
        self.assertTrue(self.check(r=run(event="push")))
        self.assertTrue(self.check(rec=record(run_id=8)))
        self.assertTrue(self.check(released=["beta"]))
        self.assertTrue(self.check("nightly"))

    def test_stable_needs_beta_and_stable_items(self):
        self.assertTrue(self.check("stable", rec=record(items=ALL)))
        self.assertTrue(self.check("stable", released=["beta"]))
        self.assertEqual(self.check("stable", rec=record(items=ALL), released=["beta"]), [])


if __name__ == "__main__":
    unittest.main()
