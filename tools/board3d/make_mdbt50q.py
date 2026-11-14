"""Raytac MDBT50Q-1MV2 (nRF52840 module, chip antenna), drawn simply, as a .glb in metres for convert_model.py.
Sizes from Raytac's 3D drawing (MDBT50Q 3D Drawing_20180620): module 10.5 x 15.5, PCB 0.80 thick,
can 9.5 x 10.9 up to 2.00, chip antenna 8.0 x 1.0 up to 2.05 at the antenna end. The look from product photos:
blue PCB, a plain metal can, the etched marking reading along the module from the antenna end
(letter tops toward +x, first line at the +x side), certification marks in the -x band, and the antenna's
black body with a white section and metal ends. Parts under or beside the can are left out.
Frame: centred on the module, x right, y up (= -KiCad y), z up from the board; the antenna end at y = +7.75.
  python3 make_mdbt50q.py <board.json> <ref> out.glb
"""
import sys
import trimesh
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely import affinity
from shapely.geometry import Point, Polygon, box as sbox
from trimesh.visual.material import PBRMaterial

out = sys.argv[3]
pieces = {}  # colour → meshes, one piece per colour

def add(color, mesh):
    mesh.unmerge_vertices()  # flat faces
    pieces.setdefault(tuple(color), []).append(mesh)

def rect(x0, x1, y0, y1):
    return sbox(x0, y0, x1, y1)

def rrect(x0, x1, y0, y1, r):
    return sbox(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, resolution=6)

def slab(color, shape, z0, z1):
    for poly in getattr(shape, "geoms", [shape]):
        m = trimesh.creation.extrude_polygon(poly, z1 - z0); m.apply_translation([0, 0, z0]); add(color, m)

BLUE, CORE, CAN, INK = [26, 84, 160, 255], [176, 164, 124, 255], [198, 200, 203, 255], [70, 72, 76, 255]
METAL, BLACK, WHITE = [206, 208, 212, 255], [22, 22, 24, 255], [238, 238, 236, 255]
PCB, TOP = 0.80, 2.00
CX0, CX1, CY0, CY1 = -4.75, 4.75, -7.3, 3.6  # the can

# PCB: blue mask on both faces, the core showing at the cut edges
slab(BLUE, rect(-5.25, 5.25, -7.75, 7.75), 0, 0.04)
slab(CORE, rect(-5.25, 5.25, -7.75, 7.75), 0.04, PCB - 0.04)
slab(BLUE, rect(-5.25, 5.25, -7.75, 7.75), PCB - 0.04, PCB)

# the can: one rounded box, its top edge softened by a slightly smaller top layer
slab(CAN, rrect(CX0, CX1, CY0, CY1, 0.45), PCB, TOP - 0.05)
slab(CAN, rrect(CX0 + 0.06, CX1 - 0.06, CY0 + 0.06, CY1 - 0.06, 0.39), TOP - 0.05, TOP)

def glyphs(s, size, weight="normal"):
    """text as shapes, read along -y (letter tops toward +x), starting at the origin"""
    tp = TextPath((0, 0), s, size=size, prop=FontProperties(family="DejaVu Sans", weight=weight))
    sh = None
    for r in tp.to_polygons():  # even-odd: the letters' holes are cut out
        if len(r) < 3: continue
        r = Polygon(r).buffer(0)
        sh = r if sh is None else sh.symmetric_difference(r)
    return affinity.rotate(sh, -90, origin=(0, 0))

def etch(sh):
    slab(INK, sh, TOP, TOP + 0.004)

def centred(sh, x, y):
    b = sh.bounds
    return affinity.translate(sh, x - (b[0] + b[2]) / 2, y - (b[1] + b[3]) / 2)

# six lines, from the +x side, starting near the antenna end of the can
y0, size, pitch = CY1 - 0.6, 0.62, 0.86
for k, s in enumerate(["Raytac Corporation", "FCC ID:SH6MDBT50Q", "IC:8017A-MDBT50Q",
                       "CMIIT ID:2018DJ5128", "Model No.:MDBT50Q", "018-180280"]):
    xb = CX1 - 0.95 - k * pitch  # baseline
    etch(affinity.translate(glyphs(s, size), xb, y0 - (1.0 if k == 5 else 0)))
xb = CX1 - 0.95 - 5 * pitch  # the boxed R before the last line
etch(rect(xb, xb + 0.56, y0 - 0.86, y0 - 0.3).difference(rect(xb + 0.07, xb + 0.49, y0 - 0.79, y0 - 0.37)))
etch(centred(glyphs("R", 0.4), xb + 0.28, y0 - 0.58))

# the marks, in a column along the -x side
xm = CX0 + 1.3
etch(Point(xm, 1.7).buffer(0.8, 32).difference(Point(xm, 1.7).buffer(0.69, 32)))  # round mark
etch(centred(glyphs("KC", 0.95, "bold"), xm, -0.6))
etch(centred(glyphs("CE", 1.15, "bold"), xm, -2.9))
tri = Polygon([(xm + 0.75, -5.4), (xm - 0.7, -4.55), (xm - 0.7, -6.25)])  # RCM triangle, apex toward +x
etch(tri.difference(tri.buffer(-0.11)))

# chip antenna along the antenna end
AY0, AY1, AT = 6.13, 7.13, 2.05
slab(METAL, rect(-3.63, -3.25, AY0, AY1), PCB, AT)
slab(BLACK, rect(-3.25, 1.2, AY0, AY1), PCB, AT)
slab(WHITE, rect(1.2, 3.75, AY0, AY1), PCB, AT)
slab(METAL, rect(3.75, 4.37, AY0, AY1), PCB, AT)

scene = trimesh.Scene()
for color, ms in pieces.items():
    m = trimesh.util.concatenate(ms)
    m.apply_scale(0.001)
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=list(color)))
    scene.add_geometry(m, node_name=f"c{len(scene.geometry)}")
scene.export(out)
print(out, len(scene.geometry), "pieces", sum(len(g.faces) for g in scene.geometry.values()), "faces")
