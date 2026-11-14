"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna) as a .glb in metres for convert_model.py.
Sizes from Raytac's own 3D drawing (MDBT50Q 3D Drawing_20180620): module 10.5 x 15.5, PCB 0.80 thick,
shield 9.5 x 10.9 up to 2.00, chip antenna 8.0 x 1.0 up to 2.05 at the antenna end; spec Ver.K: 2.05 overall.
The vendor drawing is plain boxes, so the look follows product photos: blue PCB with its core edge, a can whose
lid edge bends into a slotted skirt, the laser-etched marking (Raytac Corporation, FCC ID, IC, CMIIT ID,
Model No., 018-180280, round/KC/CE/RCM marks) reading along the module from the antenna end, the matching parts
between can and antenna, and the antenna's black body with a white section and metal ends.
Frame: centred on the module, x right, y up (= -KiCad y), z up from the board; the antenna end at y = +7.75.
  python3 make_mdbt50q.py <board.json> <ref> out.glb
"""
import json, sys
import numpy as np, trimesh
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely.geometry import Point, Polygon, box as sbox
from shapely import affinity
from trimesh.visual.material import PBRMaterial

board, ref, out = sys.argv[1:4]
scene = trimesh.Scene()
parts = {}  # colour → meshes, joined at the end (one piece per colour)

def add(color, mesh):
    mesh.unmerge_vertices()  # flat faces
    parts.setdefault(tuple(color), []).append(mesh)

def box(color, x0, x1, y0, y1, z0, z1):
    m = trimesh.creation.box(extents=[x1 - x0, y1 - y0, z1 - z0])
    m.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); add(color, m)

def slab(color, shape, z0, z1):
    for poly in getattr(shape, "geoms", [shape]):
        m = trimesh.creation.extrude_polygon(poly, z1 - z0); m.apply_translation([0, 0, z0]); add(color, m)

def rect(x0, x1, y0, y1):
    return sbox(x0, y0, x1, y1)

def rrect(x0, x1, y0, y1, r):
    return sbox(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, resolution=4)

MASK, CORE, CAN_C, INK = [24, 78, 150, 255], [168, 156, 118, 255], [196, 198, 201, 255], [62, 64, 68, 255]
TIN, DARK = [205, 207, 211, 255], [16, 18, 22, 255]
PCB, TOP = 0.80, 2.00
SX0, SX1, SY0, SY1 = -4.75, 4.75, -7.3, 3.6  # the can, from Raytac's drawing

# PCB: glossy blue mask on both faces, the glass-epoxy core at the cut edges
box(MASK, -5.25, 5.25, -7.75, 7.75, 0, 0.04)
box(CORE, -5.25, 5.25, -7.75, 7.75, 0.04, PCB - 0.04)
box(MASK, -5.25, 5.25, -7.75, 7.75, PCB - 0.04, PCB)

# the can, as in the photos: a flat lid with rounded corners whose edge bends down into a skirt,
# the skirt cut by slots that show the dark inside and the fence behind
box(DARK, SX0 + 0.25, SX1 - 0.25, SY0 + 0.25, SY1 - 0.25, PCB, TOP - 0.1)  # the inside, seen through the slots
slab(CAN_C, rrect(SX0 + 0.12, SX1 - 0.12, SY0 + 0.12, SY1 - 0.12, 0.3).difference(rrect(SX0 + 0.2, SX1 - 0.2, SY0 + 0.2, SY1 - 0.2, 0.25)), PCB, TOP - 0.45)  # inner fence
slab(CAN_C, rrect(SX0, SX1, SY0, SY1, 0.45), TOP - 0.07, TOP)  # lid
skirt = rrect(SX0, SX1, SY0, SY1, 0.45).difference(rrect(SX0 + 0.08, SX1 - 0.08, SY0 + 0.08, SY1 - 0.08, 0.37))
slots = [rect(-4.0, -2.9, SY0 - 1, SY1 + 1), rect(0.4, 1.6, SY0 - 1, SY1 + 1), rect(SX0 - 1, SX1 + 1, -5.4, -4.4),
         rect(SX0 - 1, SX1 + 1, -1.6, -0.6), rect(SX0 - 1, SX1 + 1, 1.6, 2.4)]
for sl in slots: skirt = skirt.difference(sl)
slab(CAN_C, skirt, TOP - 0.62, TOP - 0.07)

# lid marking, laser-etched in dark grey: lines run along the module from the antenna end,
# letter tops toward +x, first line at the +x side; certification marks in the -x band
def shape_of(s, size, weight="normal"):
    tp = TextPath((0, 0), s, size=size, prop=FontProperties(family="DejaVu Sans", weight=weight))
    sh = None
    for r in tp.to_polygons():  # even-odd: the letters' holes are cut out
        if len(r) < 3: continue
        r = Polygon(r).buffer(0)
        sh = r if sh is None else sh.symmetric_difference(r)
    return sh

def etch(sh):
    slab(INK, sh, TOP, TOP + 0.004)

def line(s, x, y, size):
    """text reading toward -y from (x, y), letter tops toward +x, baseline at x"""
    sh = shape_of(s, size)
    if sh is not None: etch(affinity.translate(affinity.rotate(sh, -90, origin=(0, 0)), x, y))

y0, size, pitch = SY1 - 0.55, 0.62, 0.86
for k, s in enumerate(["Raytac Corporation", "FCC ID:SH6MDBT50Q", "IC:8017A-MDBT50Q", "CMIIT ID:2018DJ5128", "Model No.:MDBT50Q"]):
    line(s, SX1 - 0.95 - k * pitch, y0, size)
xb = SX1 - 0.95 - 5 * pitch
etch(rect(xb, xb + 0.55, y0 - 1.3, y0 - 0.75).difference(rect(xb + 0.06, xb + 0.49, y0 - 1.24, y0 - 0.81)))  # the boxed R
etch(affinity.translate(affinity.rotate(shape_of("R", 0.42), -90, origin=(0, 0)), xb + 0.07, y0 - 0.83))
line("018-180280", xb, y0 - 1.5, size)

xm = SX0 + 1.25  # the marks' column centre
ring = lambda cx, cy, r, w: Point(cx, cy).buffer(r, 24).difference(Point(cx, cy).buffer(r - w, 24))
etch(ring(xm, 1.9, 0.75, 0.1))  # the round mark, with its earth-like bars
for k, (h, w) in enumerate([(0.55, 0.08), (0.38, 0.08), (0.22, 0.08)]):
    etch(rect(xm - 0.2 + k * 0.18, xm - 0.2 + k * 0.18 + w, 1.9 - h / 2, 1.9 + h / 2))
etch(rect(xm + 0.25, xm + 0.33, 1.9 - 0.06, 1.9 + 0.06).union(rect(xm - 0.45, xm + 0.3, 1.86, 1.94)))
for s, yy, sz in [("KC", -0.3, 0.95), ("CE", -2.6, 1.15)]:
    sh = shape_of(s, sz, "bold")
    sh = affinity.rotate(sh, -90, origin=(0, 0))
    b = sh.bounds
    etch(affinity.translate(sh, xm - (b[0] + b[2]) / 2, yy - (b[1] + b[3]) / 2))
tri = Polygon([(xm + 0.7, -5.2), (xm - 0.65, -4.4), (xm - 0.65, -6.0)])  # the RCM triangle, apex toward +x
etch(tri.difference(tri.buffer(-0.1)))
etch(Point(xm - 0.1, -5.2).buffer(0.32, 16).difference(Point(xm - 0.1, -5.2).buffer(0.22, 16)).difference(rect(xm - 0.1, xm + 0.4, -5.25, -5.0)))

# small parts between the can and the antenna (matching network), as seen in the photos
for x, y, w, h in [(-2.4, 4.4, 0.6, 0.3), (-1.4, 4.4, 0.6, 0.3), (-0.3, 4.6, 0.3, 0.6), (0.7, 4.4, 0.6, 0.3), (2.0, 4.5, 0.6, 0.3)]:
    box(DARK if w > h else [120, 84, 52, 255], x - w / 2 + 0.08 * (w > h), x + w / 2 - 0.08 * (w > h), y - h / 2 + 0.08 * (h > w), y + h / 2 - 0.08 * (h > w), PCB, PCB + 0.3)
    if w > h:
        box(TIN, x - w / 2, x - w / 2 + 0.1, y - h / 2, y + h / 2, PCB, PCB + 0.3); box(TIN, x + w / 2 - 0.1, x + w / 2, y - h / 2, y + h / 2, PCB, PCB + 0.3)
    else:
        box(TIN, x - w / 2, x + w / 2, y - h / 2, y - h / 2 + 0.1, PCB, PCB + 0.3); box(TIN, x - w / 2, x + w / 2, y + h / 2 - 0.1, y + h / 2, PCB, PCB + 0.3)

# chip antenna along the antenna end: black body, a white section at one end, metal end caps
AY0, AY1, AT = 6.13, 7.13, 2.05
box([22, 22, 24, 255], -3.25, 1.2, AY0, AY1, PCB, AT)
box([238, 238, 236, 255], 1.2, 3.75, AY0, AY1, PCB, AT)
box(TIN, -3.63, -3.25, AY0, AY1, PCB, AT)
box(TIN, 3.75, 4.37, AY0, AY1, PCB, AT)
box(TIN, -3.83, -3.13, AY0 - 0.1, AY1 + 0.1, PCB, PCB + 0.012)  # its solder pads
box(TIN, 3.67, 4.57, AY0 - 0.1, AY1 + 0.1, PCB, PCB + 0.012)

for color, ms in parts.items():
    m = trimesh.util.concatenate(ms)
    m.apply_scale(0.001)
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=list(color)))
    scene.add_geometry(m, node_name=f"c{len(scene.geometry)}")
scene.export(out)
print(out, len(scene.geometry), "pieces", sum(len(g.faces) for g in scene.geometry.values()), "faces")
