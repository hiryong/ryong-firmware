"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna) as a .glb in metres for convert_model.py.
Sizes from Raytac's own 3D drawing (MDBT50Q 3D Drawing_20180620): module 10.5 x 15.5, PCB 0.80 thick,
shield 9.5 x 10.9 up to 2.00, chip antenna 8.0 x 1.0 up to 2.05 at the antenna end; spec Ver.K: 2.05 overall.
The vendor drawing is plain boxes, so this adds what the part looks like: the PCB's mask and core edge,
a can with rounded corners and a separate lid, the printed lid marking (name, FCC/IC IDs, a 2D code; no date code, which differs per batch),
the antenna's tinned ends, and the slot in the PCB next to the can.
Frame: centred on the module, x right, y up (= -KiCad y), z up from the board; the antenna end at y = +7.75.
  python3 make_mdbt50q.py <board.json> <ref> out.glb
"""
import json, random, sys
import numpy as np, trimesh
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely.geometry import Polygon, box as sbox
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

def rrect(x0, x1, y0, y1, r):
    return sbox(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, resolution=4)

MASK, CORE, TIN, INK = [26, 34, 82, 255], [168, 156, 118, 255], [205, 207, 211, 255], [24, 24, 26, 255]
PCB, CAN, LID = 0.80, 2.00, 0.06

# PCB: solder mask on both faces, the glass-epoxy core showing at the cut edges
box(MASK, -5.25, 5.25, -7.75, 7.75, 0, 0.04)
box(CORE, -5.25, 5.25, -7.75, 7.75, 0.04, PCB - 0.04)
box(MASK, -5.25, 5.25, -7.75, 7.75, PCB - 0.04, PCB)
box([10, 12, 22, 255], 1.25, 3.15, 3.35, 3.85, PCB, PCB + 0.002)  # the slot through the PCB next to the can

# the can: fence, then a lid a hair larger, so the seam shows
can = rrect(-4.75, 4.75, -7.3, 3.6, 0.35)
slab(TIN, rrect(-4.72, 4.72, -7.27, 3.57, 0.33), PCB, CAN - LID)
slab(TIN, can, CAN - LID, CAN)

# lid marking, printed in black, upright with the antenna at the top
def text(s, x, y, size, weight="bold"):
    """one centred line of printed text, baseline at y (mm)"""
    tp = TextPath((0, 0), s, size=size, prop=FontProperties(family="DejaVu Sans", weight=weight))
    sh = None
    for r in tp.to_polygons():  # even-odd: the letters' holes are cut out
        if len(r) < 3: continue
        r = Polygon(r).buffer(0)
        sh = r if sh is None else sh.symmetric_difference(r)
    if sh is not None:
        slab(INK, affinity.translate(sh, x - tp.get_extents().width / 2, y), CAN, CAN + 0.004)

text("Raytac", -1.0, 1.55, 1.25)
text("MDBT50Q-1MV2", -1.0, 0.25, 0.78)
text("FCC ID: SH6MDBT50Q", 0, -0.85, 0.56, "normal")
text("IC: 8017A-MDBT50Q", 0, -1.7, 0.56, "normal")
# a 2D code (made-up pattern; the real one carries the serial and date code)
rng, n, cell, x0, y0 = random.Random(52840), 14, 0.16, -3.9, -6.6
for i in range(n):
    for j in range(n):
        on = i == 0 or j == 0 or (i == n - 1 and j % 2 == 0) or (j == n - 1 and i % 2 == 0) or (0 < i < n - 1 and 0 < j < n - 1 and rng.random() < 0.5)
        if on: box(INK, x0 + i * cell, x0 + (i + 1) * cell, y0 + j * cell, y0 + (j + 1) * cell, CAN, CAN + 0.004)

# chip antenna at the open end: ceramic body, tinned ends, orientation mark
box([20, 20, 22, 255], -3.13, 3.87, 6.13, 7.13, PCB, 2.05)
box(TIN, -3.63, -3.13, 6.13, 7.13, PCB, 2.05)
box(TIN, 3.87, 4.37, 6.13, 7.13, PCB, 2.05)
box([236, 234, 226, 255], -2.0, 0.0, 6.33, 6.93, 2.05, 2.054)
# its feed and ground pads on the PCB, tinned
box(TIN, -3.83, -3.03, 6.03, 7.23, PCB, PCB + 0.01)
box(TIN, 3.77, 4.57, 6.03, 7.23, PCB, PCB + 0.01)

for color, ms in parts.items():
    m = trimesh.util.concatenate(ms)
    m.apply_scale(0.001)
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=list(color)))
    scene.add_geometry(m, node_name=f"c{len(scene.geometry)}")
scene.export(out)
print(out, len(scene.geometry), "pieces", sum(len(g.faces) for g in scene.geometry.values()), "faces")
