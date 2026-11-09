"""EBYTE E73-2G4M08S1C (nRF52840 module) drawn from its user manual's size drawing (v1.9, §3),
as a .glb in metres for convert_model.py. The vendor's EasyEDA model has the shield and antenna
in the wrong proportions, so this one follows the drawing instead:
  module 13.0 x 18.0, 3.00 thick overall (PCB ~1.05, shield ~1.95); pins 11-25 along the top edge
  shield 10.0 x 12.1, from 1.4 mm (left) and 1.39 mm (top) in
  ceramic antenna 8.3 x 1.7 x 0.95, 15.7-17.4 mm from the top edge, outside the shield
  castellated pads (1.27 pitch) on three edges, from the board footprint's pads
Frame: centred on the module, x right, y up (= -KiCad y), z up from the board; pin 11-25 edge at y = +9.
  python3 make_e73.py <board.json> <ref> out.glb
"""
import json, sys
import numpy as np, trimesh
from trimesh.visual.material import PBRMaterial

board, ref, out = sys.argv[1:4]
part = next(p for p in json.load(open(board))["parts"] if p["ref"] == ref)
scene = trimesh.Scene()

def box(name, color, x0, x1, y0, y1, z0, z1):
    """a box between drawing coordinates: x from the left edge, y from the top (pin 11-25) edge, z up (mm)"""
    m = trimesh.creation.box(extents=[x1 - x0, y1 - y0, z1 - z0])
    m.apply_translation([(x0 + x1) / 2 - 6.5, 9 - (y0 + y1) / 2, (z0 + z1) / 2])
    m.apply_scale(0.001)
    m.unmerge_vertices()  # flat faces: each face its own vertices, so the viewer shades it as a box
    m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=color))
    scene.add_geometry(m, node_name=f"{name}{len(scene.geometry)}")

PCB = 1.05
box("pcb", [31, 74, 42, 255], 0, 13, 0, 18, 0, PCB)
box("shield", [200, 202, 206, 255], 1.4, 11.4, 1.39, 13.5, PCB, 3.0)
box("antenna", [242, 241, 236, 255], 2.7, 11.0, 15.7, 17.4, PCB, 2.0)
box("mark", [30, 30, 30, 255], 4.0, 4.8, 16.3, 16.8, 2.0, 2.01)
# castellations: the board footprint's edge pads (part centre = module centre, KiCad y down)
for px, py, pw, ph in part["pads"]:
    dx, dy = px + 6.5, py + 9  # drawing coordinates
    if dx < 0.3 or dx > 12.7:  # left / right edge
        x0 = 0 if dx < 6.5 else 12.6
        box("pad", [214, 170, 80, 255], x0 - 0.01, x0 + 0.41, dy - 0.4, dy + 0.4, -0.001, PCB + 0.01)
        box("pad", [214, 170, 80, 255], (0 if dx < 6.5 else 12.35), (0.65 if dx < 6.5 else 13.0), dy - 0.4, dy + 0.4, PCB, PCB + 0.02)
    elif dy < 0.3:  # top edge
        box("pad", [214, 170, 80, 255], dx - 0.4, dx + 0.4, -0.01, 0.41, -0.001, PCB + 0.01)
        box("pad", [214, 170, 80, 255], dx - 0.4, dx + 0.4, 0, 0.65, PCB, PCB + 0.02)
scene.export(out)
print(out, len(scene.geometry), "pieces")
