"""Build on official ZMK plus our own reviewed copy of the Studio extension, not on a third-party fork.

    python3 scripts/vendor_zmk.py manifest <workspace>/config/west.yml   # before `west update`
    python3 scripts/vendor_zmk.py apply <workspace>                      # after `west update`

`manifest` points zmk and zmk-studio-messages at the official zmkfirmware repositories, at the
upstream commits our vendored patches were taken against (vendor/zmk/base.json). `apply` then adds
the patches. The result is byte-for-byte the tree we used to fetch from cormoran/zmk@1fc72aa, so
later changes to (or removal of) that fork can never reach our builds. See vendor/zmk/README.md.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor/zmk"
BASE = json.loads((VENDOR / "base.json").read_text())
OFFICIAL = {"zmk": "https://github.com/zmkfirmware/zmk",
            "zmk-studio-messages": "https://github.com/zmkfirmware/zmk-studio-messages"}
MESSAGES_PATH = "modules/msgs/zmk-studio-messages"


def check_patches():
    for item in BASE["patches"]:
        data = (VENDOR / item["file"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise SystemExit(f"vendor/zmk/{item['file']} does not match base.json; re-review before building")


def manifest(path):
    path = Path(path)
    data = yaml.safe_load(path.read_text())
    projects = data["manifest"]["projects"]
    by_name = {p["name"]: p for p in projects}
    if "zmk" not in by_name:
        raise SystemExit("manifest has no zmk project")
    for name, rev in (("zmk", BASE["zmk"]), ("zmk-studio-messages", BASE["zmk_studio_messages"])):
        p = by_name.get(name)
        if p is None:
            # Import-style manifest (zmk imports app/west.yml): a top-level project wins over the import.
            p = {"name": name, "path": MESSAGES_PATH}
            projects.append(p)
        p.pop("remote", None)
        p["url"] = OFFICIAL[name]
        p["revision"] = rev
    path.write_text(yaml.safe_dump(data, sort_keys=False))
    print(f"official zmk {BASE['zmk'][:7]}, zmk-studio-messages {BASE['zmk_studio_messages'][:7]} (+ vendored patches)")


def apply(workspace):
    check_patches()
    ws = Path(workspace)
    for item in BASE["patches"]:
        repo = ws / item["repo_path"]
        head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        if head != item["applies_to"]:
            raise SystemExit(f"{item['repo_path']} is at {head[:7]}, the patch was reviewed for {item['applies_to'][:7]}")
        # A restored cache may still hold files a previous run added; start from the clean commit.
        subprocess.run(["git", "-C", str(repo), "restore", "--source=HEAD", "--worktree", "--staged", "."], check=True)
        subprocess.run(["git", "-C", str(repo), "clean", "-fdq"], check=True)
        subprocess.run(["git", "-C", str(repo), "apply", "--check", str(VENDOR / item["file"])], check=True)
        subprocess.run(["git", "-C", str(repo), "apply", str(VENDOR / item["file"])], check=True)
        print(f"applied {item['file']} to {item['repo_path']}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("manifest", "apply"):
        raise SystemExit(__doc__)
    check_patches()
    (manifest if sys.argv[1] == "manifest" else apply)(sys.argv[2])
