"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna), drawn from product photos, as a .glb (metres)
for convert_model.py. Only the outer sizes come from Raytac's 3D drawing (MDBT50Q 3D Drawing_20180620):
module 10.5 x 15.5 x 0.8 PCB, can 9.5 x 10.9 up to 2.0, antenna 8.0 x 1.0 at the antenna end.
What the photos show, and is drawn here:
  - blue PCB, the antenna end left open
  - the can: a flat lid whose edges fold down (a bevel all round), square corners, side walls that stop
    just short of the corners and are cut by a few slots, dark inside showing through the gaps
  - laser marking in thin grey type, lines running along the module from the antenna end:
    Raytac Corporation / FCC ID:SH6MDBT50Q / IC:8017A-MDBT50Q / CMIIT ID:2018DJ5128 /
    Model No.:MDBT50Q / [R] 018-180280, with the round (Japan), KC, CE and RCM marks beside them
  - the chip antenna along the end: black, a white band, metal end caps
Parts on the open PCB are left out.
Frame: x across the module, y along it (antenna end at +y, = -KiCad y), z up from the board; mm, exported in m.
  python3 make_mdbt50q.py <board.json> <ref> out.glb
"""
import sys
import numpy as np, trimesh
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from trimesh.visual.material import PBRMaterial

OUT = sys.argv[3]
mesh_by_colour = {}

def put(colour, m):
    m.unmerge_vertices()
    mesh_by_colour.setdefault(colour, []).append(m)

def prism(colour, shape, z0, z1):
    for p in getattr(shape, "geoms", [shape]):
        if p.area < 1e-6: continue
        m = trimesh.creation.extrude_polygon(p, z1 - z0); m.apply_translation((0, 0, z0)); put(colour, m)

def cuboid(colour, x0, x1, y0, y1, z0, z1):
    prism(colour, box(x0, y0, x1, y1), z0, z1)

PCB_BLUE = (30, 90, 168, 255)
PCB_EDGE = (182, 170, 130, 255)
STEEL = (192, 195, 198, 255)
SHADOW = (14, 16, 20, 255)
LASER = (88, 90, 94, 255)
ANT_BLACK = (20, 20, 22, 255)
ANT_WHITE = (236, 236, 233, 255)
CAP = (210, 212, 215, 255)

# PCB 10.5 x 15.5 x 0.8
prism(PCB_BLUE, box(-5.25, -7.75, 5.25, 7.75), 0.0, 0.05)
prism(PCB_EDGE, box(-5.25, -7.75, 5.25, 7.75), 0.05, 0.75)
prism(PCB_BLUE, box(-5.25, -7.75, 5.25, 7.75), 0.75, 0.80)

# the can: x -4.75..4.75, y -7.3..3.6, top 2.0
X0, X1, Y0, Y1, Z0, ZT = -4.75, 4.75, -7.3, 3.6, 0.80, 2.00
FOLD, BEVEL, WALL = 0.22, 0.16, 0.09  # fold height, how far the flat top is set in, wall thickness
cuboid(SHADOW, X0 + 0.3, X1 - 0.3, Y0 + 0.3, Y1 - 0.3, Z0, ZT - FOLD)  # the dark inside
# the folded edge: the hull of the flat top and the outline where the walls start
corners = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)]
lower = [(x, y, ZT - FOLD) for x, y in corners]
upper = [(x + (BEVEL if x < 0 else -BEVEL), y + (BEVEL if y < 0 else -BEVEL), ZT) for x, y in corners]
put(STEEL, trimesh.convex.convex_hull(np.array(lower + upper)))
# side walls, stopping 0.45 short of each corner, with slots
GAP = 0.25
walls = [box(X0 + GAP, Y0, X1 - GAP, Y0 + WALL), box(X0 + GAP, Y1 - WALL, X1 - GAP, Y1),
         box(X0, Y0 + GAP, X0 + WALL, Y1 - GAP), box(X1 - WALL, Y0 + GAP, X1, Y1 - GAP)]
slots = [box(-2.2, Y0 - 1, -1.7, Y1 + 1), box(2.0, Y0 - 1, 2.5, Y1 + 1),
         box(X0 - 1, -4.45, X1 + 1, -3.95), box(X0 - 1, -0.25, X1 + 1, 0.25)]
for w in walls:
    for s in slots: w = w.difference(s)
    prism(STEEL, w, Z0 + 0.05, ZT - FOLD + 0.01)

# laser marking on the flat top
def outline(text, size, weight="normal", stretch="condensed"):
    path = TextPath((0, 0), text, size=size, prop=FontProperties(family="DejaVu Sans", weight=weight, stretch=stretch))
    shape = None
    for ring in path.to_polygons():
        if len(ring) < 3: continue
        ring = Polygon(ring).buffer(0)
        shape = ring if shape is None else shape.symmetric_difference(ring)
    return shape

def along(shape, baseline_x, start_y):
    """lay a text shape along the module: reading toward -y from start_y, letter tops toward +x"""
    return affinity.translate(affinity.rotate(shape, -90, origin=(0, 0)), baseline_x, start_y)

def mark(shape):
    prism(LASER, shape, ZT, ZT + 0.003)

TOP_X1, TOP_Y1 = X1 - BEVEL, Y1 - BEVEL
first = TOP_Y1 - 0.45
lines = ["Raytac Corporation", "FCC ID:SH6MDBT50Q", "IC:8017A-MDBT50Q", "CMIIT ID:2018DJ5128", "Model No.:MDBT50Q"]
for i, t in enumerate(lines):
    mark(along(outline(t, 0.6), TOP_X1 - 0.75 - i * 0.82, first))
x6 = TOP_X1 - 0.75 - 5 * 0.82
mark(box(x6, first - 0.5, x6 + 0.5, first).difference(box(x6 + 0.06, first - 0.44, x6 + 0.44, first - 0.06)))
r = affinity.rotate(outline("R", 0.36), -90, origin=(0, 0)); b = r.bounds
mark(affinity.translate(r, x6 + 0.25 - (b[0] + b[2]) / 2, first - 0.25 - (b[1] + b[3]) / 2))
mark(along(outline("018-180280", 0.6), x6, first - 0.7))

col = X0 + BEVEL + 1.15  # the marks' column
# round mark: a ring with the stem-and-bars symbol inside
c = Point(col, first - 1.0)
mark(c.buffer(0.78, 40).difference(c.buffer(0.68, 40)))
mark(LineString([(col - 0.45, c.y), (col + 0.45, c.y)]).buffer(0.05, cap_style=2))
for dx, h in ((0.12, 0.42), (0.27, 0.3), (0.42, 0.18)):
    mark(LineString([(col - dx, c.y - h), (col - dx, c.y + h)]).buffer(0.045, cap_style=2))
mark(LineString([(col, c.y), (col + 0.45, c.y)]).buffer(0.045, cap_style=2))
for txt, y, size in (("KC", first - 3.3, 0.9), ("CE", first - 5.5, 1.1)):
    s = affinity.rotate(outline(txt, size, "bold", "normal"), -90, origin=(0, 0)); b = s.bounds
    mark(affinity.translate(s, col - (b[0] + b[2]) / 2, y - (b[1] + b[3]) / 2))
# RCM: a triangle with a tick, apex toward +x
ty = first - 8.0
tri = Polygon([(col + 0.75, ty), (col - 0.65, ty + 0.8), (col - 0.65, ty - 0.8)])
mark(tri.difference(tri.buffer(-0.1)))
mark(LineString([(col - 0.05, ty + 0.3), (col - 0.35, ty + 0.05), (col + 0.15, ty - 0.35)]).buffer(0.06))

# chip antenna along the antenna end, y 6.13..7.13
A0, A1, AZ = 6.13, 7.13, 2.05
cuboid(CAP, -3.63, -3.28, A0, A1, Z0, AZ)
cuboid(ANT_BLACK, -3.28, 1.15, A0, A1, Z0, AZ)
cuboid(ANT_WHITE, 1.15, 3.72, A0, A1, Z0, AZ)
cuboid(CAP, 3.72, 4.37, A0, A1, Z0, AZ)

scene = trimesh.Scene()
for colour, ms in mesh_by_colour.items():
    m = trimesh.util.concatenate(ms); m.apply_scale(0.001)
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=list(colour)))
    scene.add_geometry(m, node_name=f"part{len(scene.geometry)}")
scene.export(OUT)
print(OUT, len(scene.geometry), "colours", sum(len(g.faces) for g in scene.geometry.values()), "faces")
