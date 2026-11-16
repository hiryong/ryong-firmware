"""Decides whether a firmware build may be published. Used by firmware-release.yml.

Owner's decision 2026-11-16 (fewer than 5 users): a bench-test record is no longer required.
What stays (the "board check"):
  - the build run succeeded, came from firmware-build.yml (workflow_dispatch) on the development branch
  - the downloaded UF2's SHA-256 matches build-info.json of the same run
  - the build's target is one of our boards and the UF2 is a well-formed nRF52840 image
  - a build is published to each channel only once
A bench-test record, when there is one, is attached to the release notes but decides nothing.
The admin page shows the same rules (admin-functions/_lib/rules.ts) but only this check counts.
Exit 0 = allowed, 1 = refused (reasons printed).
"""
import hashlib
import json
import sys
from pathlib import Path

RELEASE_BRANCH = "dev/keys-ryong-runtime"


TARGETS = ("bt60", "bt60-oreo", "ryong60")
UF2_MAGIC = (0x0A324655, 0x9E5D5157, 0x0AB16F30)
NRF52840_FAMILY = 0xADA52840


def uf2_problem(data):
    """None if every 512-byte block is a UF2 block for the nRF52840, else the reason."""
    if not data or len(data) % 512:
        return "UF2 size is not a whole number of 512-byte blocks"
    count = len(data) // 512
    for n in range(count):
        b = data[n * 512:(n + 1) * 512]
        m0, m1, flags = (int.from_bytes(b[i:i + 4], "little") for i in (0, 4, 8))
        if (m0, m1, int.from_bytes(b[508:512], "little")) != UF2_MAGIC:
            return f"UF2 block {n} is damaged"
        if not flags & 0x2000 or int.from_bytes(b[28:32], "little") != NRF52840_FAMILY:
            return f"UF2 block {n} is not for the nRF52840"
        if int.from_bytes(b[20:24], "little") != n or int.from_bytes(b[24:28], "little") != count:
            return f"UF2 block {n} is out of order"
    return None


def blockers(channel, run, info, uf2_bytes, record, released, checklist=None):
    """record and checklist are accepted for the workflow's call but no longer decide anything."""
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
    if info.get("uf2_sha256") != hashlib.sha256(uf2_bytes).hexdigest():
        why.append("UF2 does not match build-info.json")
    if info.get("run_id") != run.get("id"):
        why.append("build-info.json belongs to another run")
    if info.get("target") not in TARGETS:
        why.append("unknown target board")
    problem = uf2_problem(uf2_bytes)
    if problem:
        why.append(problem)
    if channel in released:
        why.append(f"already published to {channel}")
    return why


def main():
    channel, run_path, info_path, uf2_path, record_path, released = sys.argv[1:7]
    run = json.loads(Path(run_path).read_text())
    info = json.loads(Path(info_path).read_text())
    record = json.loads(Path(record_path).read_text()) if Path(record_path).is_file() else None
    why = blockers(channel, run, info, Path(uf2_path).read_bytes(), record, [x for x in released.split(",") if x])
    for w in why:
        print(f"::error::Refused: {w}")
    sys.exit(1 if why else 0)


if __name__ == "__main__":
    main()
