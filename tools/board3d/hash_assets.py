"""Give the board's textures and part models content-hashed names, so the site can let browsers keep them
for good (public/_headers: immutable) and a changed file always arrives under a new name.
board.json and models.json keep their names (revalidated each visit) and are rewritten to point at the new names.
  python3 hash_assets.py <public/board3d/<name>>
"""
import hashlib, json, os, re, sys

d = sys.argv[1]
def hashed(prefix, name):
    """t-/m- + the name without any earlier hash + 8 hex of the content"""
    path = os.path.join(d, name)
    h = hashlib.sha256(open(path, "rb").read()).hexdigest()[:8]
    stem, ext = os.path.splitext(name)
    stem = re.sub(r"^[tm]-", "", stem)
    stem = re.sub(r"-[0-9a-f]{6,8}$", "", stem)
    new = f"{prefix}{stem}-{h}{ext}"
    if new != name: os.replace(path, os.path.join(d, new))
    return new

board = json.load(open(os.path.join(d, "board.json")))
board["textures"] = {k: hashed("t-", v) for k, v in board["textures"].items()}
json.dump(board, open(os.path.join(d, "board.json"), "w"), separators=(",", ":"))

models = json.load(open(os.path.join(d, "models.json")))
for m in models["models"]: m["file"] = hashed("m-", m["file"])
json.dump(models, open(os.path.join(d, "models.json"), "w"), indent=1)

keep = set(board["textures"].values()) | {m["file"] for m in models["models"]} | {"board.json", "models.json"}
for f in os.listdir(d):
    if f not in keep and re.match(r"^[tm]-", f): os.remove(os.path.join(d, f)); print("removed", f)
print("hashed", len(keep) - 2, "files")
