#!/usr/bin/env python3
"""
Board 3D data for the keys site's Maintenance > 보드 3D view.

Inputs (kept out of this public repository; pass their paths):
  --pcb     the KiCad board (.kicad_pcb)
  --bom     the JLCPCB BOM (Comment, Designator, Footprint, LCSC Part #, Quantity)
  --top / --bottom   board textures rendered from the Gerbers (render_textures.mjs)
Output: <out>/board.json (outline, holes, parts) next to the textures.

Only parts in the BOM (what the factory solders) become 3D parts; their size comes from the
footprint's fab/courtyard drawing or pads, their look from the part kind.
"""
import argparse, csv, json, math, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from sexpr import parse, kids, kid, num  # noqa: E402

# kind -> (Korean name, body height mm, look)
KINDS = {
    "resistor":  ("저항", 0.35, "resistor"),
    "capacitor": ("커패시터", 0.5, "capacitor"),
    "inductor":  ("인덕터", 0.8, "inductor"),
    "led":       ("LED", 0.6, "led"),
    "backlight": ("백라이트 LED", 0.75, "backlight"),
    "diode":     ("다이오드", 0.9, "diode"),
    "zener":     ("제너 다이오드", 0.4, "diode"),
    "esd":       ("ESD 보호 칩", 1.1, "ic"),
    "transistor": ("트랜지스터 (MOSFET)", 1.0, "ic"),
    "ic":        ("칩", 0.9, "ic"),
    "module":    ("Bluetooth 모듈 (nRF52840)", 1.9, "module"),
    "usb":       ("USB-C 커넥터", 3.2, "usb"),
    "connector": ("커넥터", 2.9, "connector"),
    "hotswap":   ("핫스왑 소켓", 1.8, "hotswap"),
    "button":    ("버튼", 1.5, "button"),
    "slide":     ("슬라이드 스위치", 1.4, "slide"),
    "crystal":   ("크리스털 (32.768kHz)", 0.8, "crystal"),
    "fuse":      ("퓨즈 (PPTC)", 0.8, "fuse"),
}

# what each part does, in plain Korean (by designator or part number)
ROLE = {
    "BL": "키 밑에서 위로 비추는 백라이트 LED. 기판 구멍을 통해 스위치 쪽으로 빛이 나가요.",
    "D3": "키 매트릭스 다이오드. 여러 키를 동시에 눌러도 잘못 읽히지 않게 해요.",
    "U8": "스위치를 납땜 없이 꽂는 핫스왑 소켓 (MX 호환).",
    "U2": "nRF52840 Bluetooth·USB 모듈. 키보드의 두뇌예요.",
    "U5": "배터리 충전 칩 (BQ24075).",
    "U1": "배터리 잔량 측정 칩 (MAX17048).",
    "U3": "설정 저장용 EEPROM (24C128).",
    "U81": "키별 LED 드라이버 (IS31FL3746A).",
    "U83": "USB 전원 스위치 (TPS2553).",
    "USB1": "USB-C 포트.",
    "D2": "USB 정전기(ESD) 보호.",
    "DZ1": "과전압 보호 제너 다이오드.",
    "BT1": "배터리 쪽 과전류 퓨즈 (PPTC, 1.5A).",
    "CN1": "배터리 커넥터 (Molex PicoBlade 3핀).",
    "J3": "I2C 확장 커넥터 (JST SH 4핀).",
    "J4": "외부 스위치용 커넥터 (JST SH 2핀).",
    "SW1": "리셋 버튼.",
    "SW2": "전원 스위치 (ON/OFF).",
    "X1": "저전력 시계용 32.768kHz 크리스털.",
    "LED1": "상태 표시 LED (빨강).",
    "L1": "전원 회로 인덕터.",
}

def kind_of(ref: str, fp: str, comment: str) -> str:
    p = re.match(r"[A-Z]+", ref).group(0)
    f = fp.lower()
    if p == "BL": return "backlight"
    if p == "R": return "resistor"
    if p == "C": return "capacitor"
    if p == "L": return "inductor"
    if p == "LED": return "led"
    if p == "DZ": return "zener"
    if p == "D": return "esd" if "sot-23" in f else "diode"
    if p == "Q": return "transistor"
    if p == "X": return "crystal"
    if p == "BT": return "fuse"
    if p == "USB": return "usb"
    if p in ("CN", "J"): return "connector"
    if p == "SW": return "slide" if "mk-11" in f else "button"
    if p == "U":
        if "keyboard-sw" in f: return "hotswap"
        if "wirelm" in f or "e73" in comment.lower(): return "module"
        return "ic"
    return "ic"

def role_of(ref: str) -> str:
    if ref in ROLE: return ROLE[ref]
    p = re.match(r"[A-Z]+", ref).group(0)
    if p == "BL": return ROLE["BL"]
    if p == "D" and ref not in ("D2",): return ROLE["D3"]
    if p == "U" and ref.startswith("U") and 8 <= int(re.sub(r"\D", "", ref) or 0) <= 66: return ROLE["U8"]
    if p == "LED": return ROLE["LED1"]
    return ""

def rot(x, y, deg):
    """KiCad footprint-local to board: y points down, angles counter-clockwise on screen."""
    a = math.radians(deg)
    return x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)

def shape_points(g):
    """Points of a graphics item (fp_line/fp_rect/fp_poly/fp_circle/fp_arc), local coords."""
    h = g[0]
    if h in ("fp_line", "gr_line", "fp_rect", "gr_rect"):
        s, e = kid(g, "start"), kid(g, "end")
        x1, y1, x2, y2 = num(s[1]), num(s[2]), num(e[1]), num(e[2])
        if h.endswith("rect"):
            return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        return [(x1, y1), (x2, y2)]
    if h in ("fp_poly", "gr_poly"):
        return [(num(p[1]), num(p[2])) for p in kids(kid(g, "pts"), "xy")]
    if h in ("fp_circle", "gr_circle"):
        c, e = kid(g, "center"), kid(g, "end")
        cx, cy = num(c[1]), num(c[2]); r = math.hypot(num(e[1]) - cx, num(e[2]) - cy)
        return [(cx + r * math.cos(t * math.pi / 12), cy + r * math.sin(t * math.pi / 12)) for t in range(24)]
    if h in ("fp_arc", "gr_arc"):
        return [(num(kid(g, k)[1]), num(kid(g, k)[2])) for k in ("start", "mid", "end")]
    return []

def layer_of(g):
    l = kid(g, "layer")
    return l[1] if l else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pcb", required=True); ap.add_argument("--bom", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--name", default="ryong60")
    ap.add_argument("--title", default="ryong60 (geist rev 1.0)")
    a = ap.parse_args()

    board = parse(Path(a.pcb).read_text(encoding="utf-8"))
    thickness = num(kid(kid(board, "general"), "thickness")[1])

    bom = {}
    with open(a.bom, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for ref in row["Designator"].split(","):
                bom[ref.strip()] = row

    # board outline: the top-level Edge.Cuts polygon (this board has exactly one)
    outline = None
    for g in board[1:]:
        if isinstance(g, list) and g and g[0] in ("gr_poly",) and layer_of(g) == "Edge.Cuts":
            outline = shape_points(g)
    if not outline:
        sys.exit("no Edge.Cuts gr_poly outline")
    minx = min(p[0] for p in outline); maxx = max(p[0] for p in outline)
    miny = min(p[1] for p in outline); maxy = max(p[1] for p in outline)
    W, H = maxx - minx, maxy - miny
    to_board = lambda x, y: (round(x - minx, 3), round(y - miny, 3))

    holes, parts = [], []
    for fp in kids(board, "footprint"):
        lib = fp[1]
        side = "top" if layer_of(fp) == "F.Cu" else "bottom"
        at = kid(fp, "at"); fx, fy = num(at[1]), num(at[2]); fr = num(at[3]) if len(at) > 3 else 0.0
        props = {p[1]: p[2] for p in kids(fp, "property")}
        ref, value = props.get("Reference", ""), props.get("Value", "")
        place = lambda lx, ly: (lambda d: (fx + d[0], fy + d[1]))(rot(lx, ly, fr))

        # cutouts drawn in the footprint (backlight LED windows) and drilled holes
        for g in fp[1:]:
            if isinstance(g, list) and g and g[0].startswith("fp_") and layer_of(g) == "Edge.Cuts":
                pts = [to_board(*place(x, y)) for x, y in shape_points(g)]
                if g[0] in ("fp_rect", "fp_poly", "fp_circle"):
                    holes.append({"poly": pts})
        for pad in kids(fp, "pad"):
            drill = kid(pad, "drill")
            if drill and len(drill) > 1:
                pat = kid(pad, "at"); px, py = place(num(pat[1]), num(pat[2]))
                vals = [num(v) for v in drill[1:] if not isinstance(v, list) and v != "oval"]
                if vals:
                    dx = vals[0]; dy = vals[1] if len(vals) > 1 else dx
                    bx, by = to_board(px, py)
                    prot = num(pat[3]) if len(pat) > 3 else fr
                    holes.append({"x": bx, "y": by, "dx": round(dx, 3), "dy": round(dy, 3), "rot": round(prot, 1)})

        row = bom.get(ref)
        if not row:
            continue  # not soldered by the factory (switch footprints, logos, test pads)

        # body size: fab drawing, else courtyard minus margin, else pads
        def local_bbox(layers):
            pts = []
            for g in fp[1:]:
                if isinstance(g, list) and g and g[0].startswith("fp_") and layer_of(g) in layers:
                    pts += shape_points(g)
            return pts
        pts = local_bbox(("F.Fab", "B.Fab"))
        margin = 0.0
        if len(pts) < 2:
            pts = local_bbox(("F.CrtYd", "B.CrtYd")); margin = 0.25
        if len(pts) < 2:
            for pad in kids(fp, "pad"):
                pat, sz = kid(pad, "at"), kid(pad, "size")
                x, y, w, h = num(pat[1]), num(pat[2]), num(sz[1]) / 2, num(sz[2]) / 2
                pts += [(x - w, y - h), (x + w, y + h)]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        bw = max(0.3, max(xs) - min(xs) - 2 * margin); bl = max(0.3, max(ys) - min(ys) - 2 * margin)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        gx, gy = to_board(*place(cx, cy))

        fpname = lib.split(":")[-1]
        k = kind_of(ref, fpname, row["Comment"])
        kname, height, look = KINDS[k]
        # pads (for solder fillets / leads), local to the part centre, unrotated
        pads = []
        for pad in kids(fp, "pad"):
            if pad[2] not in ("smd", "thru_hole"):
                continue
            pat, sz = kid(pad, "at"), kid(pad, "size")
            pads.append([round(num(pat[1]) - cx, 3), round(num(pat[2]) - cy, 3), round(num(sz[1]), 3), round(num(sz[2]), 3)])
        parts.append({
            "ref": ref, "value": value or row["Comment"], "part": row["Comment"], "lcsc": row["LCSC Part #"],
            "footprint": fpname, "kind": k, "kindName": kname, "look": look, "role": role_of(ref),
            "x": gx, "y": gy, "rot": round(fr, 2), "side": side,
            "w": round(bw, 3), "l": round(bl, 3), "h": height, "pads": pads[:40],
        })

    # sanity: every BOM designator placed
    placed = {p["ref"] for p in parts}
    missing = sorted(set(bom) - placed)
    if missing:
        print("warning: in BOM but not on the board:", missing, file=sys.stderr)

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    data = {
        "name": a.name, "title": a.title, "units": "mm", "thickness": thickness,
        "width": round(W, 3), "height": round(H, 3),
        "outline": [to_board(x, y) for x, y in outline],
        "holes": holes, "parts": parts,
        "textures": {"top": "top.webp", "bottom": "bottom.webp"},
        "colors": {"mask": "white", "silk": "black"},
    }
    (out / "board.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(parts)} parts, {len(holes)} holes, board {W:.1f} x {H:.1f} mm -> {out/'board.json'}")

if __name__ == "__main__":
    main()
