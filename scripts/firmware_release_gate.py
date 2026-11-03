"""Decides whether a firmware build may be published. Used by firmware-release.yml.

The admin page shows the same rules (admin-functions/_lib/rules.ts) but only this check counts:
  - the build run succeeded and came from firmware-build.yml
  - the downloaded UF2's SHA-256 matches both build-info.json and the bench-test record
  - the record was made on the build's own target board and every required item passed
  - stable additionally needs the stable-only items and an existing beta release of the same build
Exit 0 = allowed, 1 = refused (reasons printed).
"""
import hashlib
import json
import sys
from pathlib import Path

CHECKLIST = Path(__file__).resolve().parents[1] / "apps/keys-ryong-runtime/admin-functions/_lib/checklist.json"


RELEASE_BRANCH = "dev/keys-ryong-runtime"


def evaluate(items, checklist):
    required = [i for i in checklist["items"] if i["required"]]
    stable = [i for i in checklist["items"] if i["required"] or i.get("stable")]
    if any(v == "fail" for v in items.values()):
        return "fail", False
    result = "pass" if all(items.get(i["id"]) == "pass" for i in required) else "incomplete"
    return result, result == "pass" and all(items.get(i["id"]) == "pass" for i in stable)


def blockers(channel, run, info, uf2_bytes, record, released, checklist):
    why = []
    if channel not in ("beta", "stable"):
        return ["unknown channel"]
    if run.get("conclusion") != "success":
        why.append("build run did not succeed")
    if not str(run.get("path", "")).endswith("/firmware-build.yml") or run.get("event") != "workflow_dispatch":
        why.append("run is not a firmware-build.yml build")
    # Only builds of the development branch can be released (another branch could carry a changed gate).
    if run.get("head_branch") != RELEASE_BRANCH:
        why.append("build is not from " + RELEASE_BRANCH)
    actual = hashlib.sha256(uf2_bytes).hexdigest()
    if info.get("uf2_sha256") != actual:
        why.append("UF2 does not match build-info.json")
    if info.get("run_id") != run.get("id"):
        why.append("build-info.json belongs to another run")
    if record is None:
        why.append("no bench-test record")
        return why
    if record.get("run_id") != run.get("id"):
        why.append("record belongs to another run")
    if record.get("uf2_sha256") != actual:
        why.append("record was made for a different file")
    if record.get("tested_board") != info.get("target"):
        why.append("not tested on the build's target board")
    result, stable_ready = evaluate(record.get("items", {}), checklist)
    if result != "pass":
        why.append(f"bench test result is {result}")
    if channel == "stable":
        if not stable_ready:
            why.append("stable-only checks have not passed")
        if "beta" not in released:
            why.append("publish to beta first")
    if channel in released:
        why.append(f"already published to {channel}")
    return why


def main():
    channel, run_path, info_path, uf2_path, record_path, released = sys.argv[1:7]
    checklist = json.loads(CHECKLIST.read_text())
    run = json.loads(Path(run_path).read_text())
    info = json.loads(Path(info_path).read_text())
    record = json.loads(Path(record_path).read_text()) if Path(record_path).is_file() else None
    why = blockers(channel, run, info, Path(uf2_path).read_bytes(), record, [x for x in released.split(",") if x], checklist)
    for w in why:
        print(f"::error::Refused: {w}")
    sys.exit(1 if why else 0)


if __name__ == "__main__":
    main()
