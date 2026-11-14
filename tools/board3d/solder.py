"""Solder only where the factory fits a part: the colour texture keeps the solder-paste look on the pads of
parts in board.json (the assembled ones) and shows bare ENIG gold on every other pad, as on the board as
delivered (unpopulated footprints, test pads, contacts).
  python3 solder.py <render dir with top.png, top-bare.png, ...> <board.json> <out dir>   → top.webp, bottom.webp
"""
import json, math, sys
from PIL import Image, ImageDraw

src, board_json, out = sys.argv[1:4]
b = json.load(open(board_json))
for side in ("top", "bottom"):
    soldered = Image.open(f"{src}/{side}.png").convert("RGBA")
    bare = Image.open(f"{src}/{side}-bare.png").convert("RGBA")
    ppm = soldered.width / b["width"]
    mask = Image.new("L", soldered.size, 0); d = ImageDraw.Draw(mask)
    for p in b["parts"]:
        if p.get("side", "top") != side: continue
        a = math.radians(p["rot"]); c, s = math.cos(a), math.sin(a)
        for px, py, w, h in p.get("pads", []):
            corners = [(px + dx * w / 2 * 1.15, py + dy * h / 2 * 1.15) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            pts = []
            for x, y in corners:  # footprint rotation (KiCad, y down), then onto the board
                bx, by = p["x"] + x * c + y * s, p["y"] - x * s + y * c
                if side == "bottom": bx = b["width"] - bx  # the bottom texture is seen from below
                pts.append((bx * ppm, by * ppm))
            d.polygon(pts, fill=255)
    Image.composite(soldered, bare, mask).save(f"{out}/{side}.webp", "WEBP", quality=88, method=6)
    print(side, "soldered pads drawn for", sum(1 for p in b["parts"] if p.get("side", "top") == side), "parts")
