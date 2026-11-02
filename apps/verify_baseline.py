"""Verify the independently imported baseline without contacting the original repo."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
manifest = json.loads((root / "baseline-manifest.json").read_text())
for entry in manifest["files"]:
    data = (root / "keys-ryong" / entry["path"]).read_bytes()
    sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if sha != entry["sha"]:
        raise SystemExit("Baseline changed: " + entry["path"])
print(f'PASS: {len(manifest["files"])} original source/assets match {manifest["commit"]}')
