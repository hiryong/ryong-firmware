"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna), drawn from product photos, as a .glb (metres)
for convert_model.py. Only the outer sizes come from Raytac's 3D drawing (MDBT50Q 3D Drawing_20180620):
module 10.5 x 15.5 x 0.8 PCB, can 9.5 x 10.9 up to 2.0, antenna 8.0 x 1.0 at the antenna end.
What the photos show, and is drawn here:
  - blue PCB, the antenna end left open
  - the can: a flat lid whose edges fold down (a bevel all round), square corners, side walls that stop
    just short of the corners and are cut by a few slots, dark inside showing through the gaps
  - laser marking, placed as measured on a top-down photo: six lines along the module from the antenna end
    (Raytac Corporation / FCC ID:SH6MDBT50Q / IC:8017A-MDBT50Q / CMIIT ID:2018DJ5128 / Model No.:MDBT50Q /
    [R] 018-180280), the round Japan mark at their start, KC, CE and RCM down the left side
  - the chip antenna along the end, low: a long metal clip, a white section, a black dotted section,
    a short metal clip (left to right with the antenna end up)
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
CERAMIC = (204, 205, 201, 255)
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

# laser marking, laid out as measured from a top-down product photo (antenna end up): u across the can
# from its left edge, v down the can from its antenna-end edge, in mm. Every line and mark is turned so its
# letter tops face +x (right) and it reads toward the far end; "Raytac Corporation" is the line at the right.
def U(u): return X0 + u
def V(v): return Y1 - v

def glyphs(text, weight="normal"):
    path = TextPath((0, 0), text, size=1.0, prop=FontProperties(family="DejaVu Sans", weight=weight))
    shape = None
    for ring in path.to_polygons():
        if len(ring) < 3: continue
        ring = Polygon(ring).buffer(0)
        shape = ring if shape is None else shape.symmetric_difference(ring)
    return shape

def mark(shape):
    prism(LASER, shape, ZT, ZT + 0.003)

CAP_H = 0.62  # letter height on the part
def text_line(text, u_centre, v_start, v_end):
    """one line, stretched to run from v_start to v_end as on the part"""
    g = glyphs(text); b = g.bounds
    g = affinity.scale(g, (v_end - v_start) / (b[2] - b[0]), CAP_H / 0.729, origin=(b[0], 0))
    g = affinity.translate(g, -b[0], 0)
    g = affinity.rotate(g, -90, origin=(0, 0))  # reading toward -y, tops toward +x
    mark(affinity.translate(g, U(u_centre - CAP_H / 2), V(v_start)))

for text, u, v0, v1 in (("Raytac Corporation", 7.6, 1.3, 6.9),
                        ("FCC ID:SH6MDBT50Q", 6.8, 1.3, 8.5),
                        ("IC:8017A-MDBT50Q", 6.0, 1.3, 8.4),
                        ("CMIIT ID:2018DJ5128", 5.2, 1.3, 8.4),
                        ("Model No.:MDBT50Q", 4.4, 1.3, 8.0),
                        ("018-180280", 3.6, 4.1, 7.8)):
    text_line(text, u, v0, v1)

def emblem(shape, u, v, size):
    """a mark turned like the text (its top toward +x), centred at (u, v), its larger side = size"""
    shape = affinity.rotate(shape, -90, origin=(0, 0)); b = shape.bounds
    k = size / max(b[2] - b[0], b[3] - b[1])
    shape = affinity.scale(shape, k, k, origin=((b[0] + b[2]) / 2, (b[1] + b[3]) / 2))
    b = shape.bounds
    mark(affinity.translate(shape, U(u) - (b[0] + b[2]) / 2, V(v) - (b[1] + b[3]) / 2))

# the boxed R before "018-180280"
emblem(box(0, 0, 1, 1).difference(box(0.12, 0.12, 0.88, 0.88)).union(affinity.translate(affinity.scale(glyphs("R"), 0.85, 0.85, origin=(0, 0)), 0.22, 0.18)), 3.6, 3.6, 0.45)
# round (Japan) mark: a ring around a stem with cross bars
ring = Point(0, 0).buffer(1, 48).difference(Point(0, 0).buffer(0.87, 48))
sym = LineString([(0, -0.6), (0, 0.6)]).buffer(0.07, cap_style=2)
for y, w in ((0.35, 0.55), (0.12, 0.42), (-0.1, 0.3)):
    sym = sym.union(LineString([(-w, y), (w, y)]).buffer(0.06, cap_style=2))
sym = sym.union(LineString([(0.15, -0.25), (0.45, -0.55)]).buffer(0.06))
emblem(ring.union(sym), 2.7, 2.0, 1.4)
emblem(glyphs("KC"), 1.75, 3.7, 1.2)
emblem(glyphs("CE"), 1.8, 5.4, 1.2)
# RCM: a triangle around a circle with a tick
tri = Polygon([(-1, -0.8), (1, -0.8), (0, 0.95)])
rcm = tri.difference(tri.buffer(-0.11))
rcm = rcm.union(Point(0, -0.15).buffer(0.42, 32).difference(Point(0, -0.15).buffer(0.32, 32)))
rcm = rcm.union(LineString([(-0.18, -0.15), (-0.03, -0.32), (0.25, 0.08)]).buffer(0.05))
emblem(rcm, 1.6, 7.6, 1.4)

# chip antenna along the antenna end, as in the top-down photo (antenna end up): from the left, a long
# metal clip, a white section, a black section with a grid of dots, a short metal clip. Low: well below the can.
A0, A1 = 6.13, 7.13
AT = Z0 + 0.85
cuboid(CERAMIC, -2.35, 3.6, A0 + 0.05, A1 - 0.05, Z0, AT - 0.01)  # body sides
cuboid(ANT_WHITE, -2.35, -0.25, A0 + 0.05, A1 - 0.05, AT - 0.01, AT)
cuboid(ANT_BLACK, -0.25, 3.6, A0 + 0.05, A1 - 0.05, AT - 0.01, AT)
for i in range(9):
    for y in (A0 + 0.35, A1 - 0.35):
        x = 0.05 + i * 0.4
        prism(CERAMIC, Point(x, y).buffer(0.07, 8), AT, AT + 0.002)
for c0, c1 in ((-3.63, -2.35), (3.6, 4.37)):
    cuboid(CAP, c0, c1, A0, A1, Z0, AT + 0.05)
    for k in range(1, 4):  # ridges across the clip
        y = A0 + k * (A1 - A0) / 4
        cuboid(SHADOW, c0, c1, y - 0.025, y + 0.025, AT + 0.05, AT + 0.053)

scene = trimesh.Scene()
for colour, ms in mesh_by_colour.items():
    m = trimesh.util.concatenate(ms); m.apply_scale(0.001)
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=list(colour)))
    scene.add_geometry(m, node_name=f"part{len(scene.geometry)}")
scene.export(OUT)
print(OUT, len(scene.geometry), "colours", sum(len(g.faces) for g in scene.geometry.values()), "faces")
