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
import argparse, json, math, re, struct, tempfile
from collections import defaultdict

ap = argparse.ArgumentParser()
ap.add_argument("model"); ap.add_argument("out")
ap.add_argument("--dx", type=float, default=0); ap.add_argument("--dy", type=float, default=0)
ap.add_argument("--offset", type=float, nargs=3, default=(0, 0, 0))
ap.add_argument("--rotate", type=float, default=0, help="KiCad model rotation about z, degrees (applied before the offset)")
ap.add_argument("--drop", nargs="*", default=[], help="colours to leave out (e.g. a vendor logo printed on the part)")
ap.add_argument("--patch", nargs=6, action="append", default=[], metavar=("X0", "Y0", "X1", "Y1", "Z", "COLOR"), help="cover a rectangle (model mm, facing up) — e.g. a vendor logo engraved into a metal shell")
ap.add_argument("--recolor", nargs="*", default=[], help="FROM=TO colour pairs, e.g. to match the real part's plastic")
ap.add_argument("--cover", nargs=7, action="append", default=[], metavar=("X0", "Y0", "Z0", "X1", "Y1", "Z1", "COLOR"), help="a thin box (model mm) over a printed logo, in the colour of the surface under it")
ap.add_argument("--no-logo", action="store_true", help="EasyEDA models: leave out the LCEDA logo (a small, finely triangulated white or flat piece) and seat chips modelled centred on z = 0")
ap.add_argument("--thickness", type=float, default=1.6); ap.add_argument("--flip", action="store_true")
a = ap.parse_args()
groups = defaultdict(lambda: {"P": [], "I": []})

def place(mx, my, mz):
    """model mm (KiCad 3D frame: x right, y up = -KiCad y, z up off the footprint side) → view frame"""
    if a.rotate:
        t = math.radians(a.rotate); mx, my = mx * math.cos(t) - my * math.sin(t), mx * math.sin(t) + my * math.cos(t)
    mx, my, mz = mx + a.offset[0], my + a.offset[1], mz + a.offset[2]
    if a.flip: return (mx + a.dx, -mz - a.thickness, my + a.dy)
    return (mx + a.dx, mz, -my + a.dy)

RECOLOR = dict(x.split("=") for x in a.recolor)

def add(color, pts, tris):
    if color in a.drop: return
    color = RECOLOR.get(color, color)
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
    parts = []
    for g in trimesh.load(glb).dump(concatenate=False):  # scene graph transforms applied; metres
        c = g.visual.material.baseColorFactor if hasattr(g.visual, "material") else (128, 128, 128, 255)
        parts.append(("#%02x%02x%02x" % tuple(int(v) for v in c[:3]), [tuple(v * 1000 for v in p) for p in g.vertices.tolist()], g.faces.tolist()))
    allp = [p for _, pts, _ in parts for p in pts]
    lo = [min(p[k] for p in allp) for k in range(3)]; hi = [max(p[k] for p in allp) for k in range(3)]
    dz = 0.0
    if a.no_logo and lo[2] < -0.05 and abs(hi[2] + lo[2]) < 0.1 * (hi[2] - lo[2]):
        dz = -lo[2]  # a chip modelled centred on z = 0: seat it on the board
        print(f"seated: +{dz:.2f} mm")
    area = (hi[0] - lo[0]) * (hi[1] - lo[1])
    def is_logo(color, pts, tris):
        if not a.no_logo or len(tris) < 600: return False
        e = [max(p[k] for p in pts) - min(p[k] for p in pts) for k in range(3)]
        if min(e) < 0.03: return True  # a flat print
        return color == "#ffffff" and len(tris) > 1500 and e[0] * e[1] < 0.5 * area  # a small, finely cut white piece
    for i, (color, pts, tris) in enumerate(parts):
        if is_logo(color, pts, tris):
            # EasyEDA cuts its logo into the part and fills it with this piece: give the fill the colour of
            # the surface around it, so the part reads plain (dropping it would leave the letters as holes)
            c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
            def gap(j):  # distance from the logo's centre to piece j's box, then the smaller box
                q = parts[j][1]; lo_ = [min(p[k] for p in q) for k in range(3)]; hi_ = [max(p[k] for p in q) for k in range(3)]
                d = sum(max(lo_[k] - c[k], 0, c[k] - hi_[k]) ** 2 for k in range(3))
                return (round(d, 4), (hi_[0] - lo_[0]) * (hi_[1] - lo_[1]) * (hi_[2] - lo_[2]))
            near = min((j for j in range(len(parts)) if j != i and not is_logo(*parts[j])), key=gap, default=None)
            if near is not None: color = parts[near][0]
            print(f"logo blended: {len(tris)} triangles → {color}")
        add(color, [(x, y, z + dz) for x, y, z in pts], tris)

for x0, y0, x1, y1, z, color in a.patch:
    x0, y0, x1, y1, z = map(float, (x0, y0, x1, y1, z))
    add(color, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [(0, 1, 2), (0, 2, 3)])

for *v, color in a.cover:
    x0, y0, z0, x1, y1, z1 = map(float, v)
    pts = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]  # index = x + 2y + 4z
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]  # outward, CCW
    add(color, pts, [t for q in quads for t in ((q[0], q[1], q[2]), (q[0], q[2], q[3]))])

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
