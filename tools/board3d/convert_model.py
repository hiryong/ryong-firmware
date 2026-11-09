"""Part 3D model (.wrl from KiCad StepUp, or .step) → a small binary mesh the 3D view loads.

  python3 convert_model.py model.wrl out.bin --flip --dx 1.53 --dy -3.777
  python3 convert_model.py model.step out.bin --offset 0 -1.15 -1.1   # KiCad (model (offset ...))

Positions end up in the frame the view uses for a part: x right, z = KiCad y (down), y up off the
board face the part sits on, mm. --offset is the footprint's KiCad model offset (mm, y up).
--flip turns a model drawn under the board (KiCad B side, z < 0) over onto the part's side;
--dx/--dy then move it onto our footprint's origin (KiCad x, y).
.step needs: pip install cascadio trimesh.

File: b"RYM1", uint32 json length, json {"scale", "groups": [{"color", "verts", "tris"}]},
padding to 4, then per group int16 xyz × verts (× scale = mm), padding to 4, uint16 indices.
"""
import argparse, json, re, struct, tempfile
from collections import defaultdict

ap = argparse.ArgumentParser()
ap.add_argument("model"); ap.add_argument("out")
ap.add_argument("--dx", type=float, default=0); ap.add_argument("--dy", type=float, default=0)
ap.add_argument("--offset", type=float, nargs=3, default=(0, 0, 0))
ap.add_argument("--drop", nargs="*", default=[], help="colours to leave out (e.g. a vendor logo printed on the part)")
ap.add_argument("--patch", nargs=6, action="append", default=[], metavar=("X0", "Y0", "X1", "Y1", "Z", "COLOR"), help="cover a rectangle (model mm, facing up) — e.g. a vendor logo engraved into a metal shell")
ap.add_argument("--thickness", type=float, default=1.6); ap.add_argument("--flip", action="store_true")
a = ap.parse_args()
groups = defaultdict(lambda: {"P": [], "I": []})

def place(mx, my, mz):
    """model mm (KiCad 3D frame: x right, y up = -KiCad y, z up off the footprint side) → view frame"""
    mx, my, mz = mx + a.offset[0], my + a.offset[1], mz + a.offset[2]
    if a.flip: return (mx + a.dx, -mz - a.thickness, my + a.dy)
    return (mx + a.dx, mz, -my + a.dy)

def add(color, pts, tris):
    if color in a.drop: return
    g = groups[color]; base = len(g["P"])
    g["P"] += [place(*p) for p in pts]
    if len(g["P"]) > 65535: raise SystemExit(f"{color}: more than 65535 vertices")
    g["I"] += [(base + i, base + j, base + k) for i, j, k in tris]

if a.model.lower().endswith(".wrl"):
    src = open(a.model).read()
    for m in re.finditer(r"geometry IndexedFaceSet\s*\{.*?coordIndex \[(.*?)\].*?point \[(.*?)\].*?diffuseColor ([\d.]+) ([\d.]+) ([\d.]+)", src, re.S):
        idx = [int(x) for x in re.split(r"[,\s]+", m.group(1).strip()) if x]
        pts = [tuple(float(v) * 2.54 for v in x.split()) for x in m.group(2).split(",") if x.strip()]  # 0.1 inch units
        tris, poly = [], []
        for i in idx:
            if i < 0:
                tris += [(poly[0], poly[k], poly[k + 1]) for k in range(1, len(poly) - 1)]; poly = []
            else: poly.append(i)
        add("#%02x%02x%02x" % tuple(round(float(c) * 255) for c in m.group(3, 4, 5)), pts, tris)
else:
    import cascadio, trimesh
    glb = tempfile.mktemp(suffix=".glb")
    cascadio.step_to_glb(a.model, glb, tol_linear=0.01, tol_angular=0.3)
    for g in trimesh.load(glb).dump(concatenate=False):  # scene graph transforms applied; metres
        c = g.visual.material.baseColorFactor if hasattr(g.visual, "material") else (128, 128, 128, 255)
        add("#%02x%02x%02x" % tuple(int(v) for v in c[:3]), [tuple(v * 1000 for v in p) for p in g.vertices.tolist()], g.faces.tolist())

for x0, y0, x1, y1, z, color in a.patch:
    x0, y0, x1, y1, z = map(float, (x0, y0, x1, y1, z))
    add(color, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [(0, 1, 2), (0, 2, 3)])

span = max(abs(c) for g in groups.values() for p in g["P"] for c in p)
scale = span / 32767
meta = {"scale": scale, "groups": [{"color": c, "verts": len(g["P"]), "tris": len(g["I"])} for c, g in groups.items()]}
js = json.dumps(meta).encode()
out = bytearray(b"RYM1" + struct.pack("<I", len(js)) + js)
out += b"\0" * (-len(out) % 4)
for g in groups.values():
    for p in g["P"]: out += struct.pack("<3h", *(round(c / scale) for c in p))
    out += b"\0" * (-len(out) % 4)
    for t in g["I"]: out += struct.pack("<3H", *t)
    out += b"\0" * (-len(out) % 4)
open(a.out, "wb").write(out)
print(a.out, len(out), "bytes", meta)
