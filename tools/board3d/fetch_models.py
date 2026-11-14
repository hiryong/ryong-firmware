"""Real 3D models for the parts on the board, placed the way the board's KiCad file places them.

  python3 fetch_models.py --pcb board.kicad_pcb --bom BOM.csv --out <board3d dir> --cache <dir>

For each footprint the factory assembles, the KiCad file names a 3D model and its offset/rotation:
- EASYEDA_MODELS/*.step: the part's own LCSC/EasyEDA model, fetched by its LCSC number
  (easyeda.com component API → modules.easyeda.com STEP), placed on EasyEDA's footprint for it and
  then turned (quarter turns) so that footprint's pads lie on ours: the board can use a turned
  variant of that footprint. EasyEDA's z offset is ignored: its STEP models sit on z = 0.
- ${KICAD*_3DMODEL_DIR}/<lib>.3dshapes/<name>: KiCad's official model (kicad-packages3D, its .step).
Resistors are left as drawn shapes (plain 0402 chips). Each model becomes <name>.bin (convert_model.py);
models.json maps it to the parts that use it. Per-model fixes (a logo cut into a part, a plastic
colour that should match the real part) are in FIXES.
"""
import argparse, gzip, csv, hashlib, json, math, os, re, subprocess, sys, urllib.request
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from sexpr import parse, kids, kid, num

FIXES = {  # model file name → extra convert_model.py arguments
    # purple, as in the LCSC photo; the logo cut into its side covered (filling it still shows the letters)
    "SMD_KEYBOARD-SW.step": ["--recolor", "#230092=#5a50b4", "--cover", "1.4", "1.05", "0.38", "3.75", "1.062", "1.18", "#230092"],
    "WIRELM-SMD_L18.0-W13.0-H3.0-E73-2G4M08S1C.step": ["--recolor", "#60574e=#c9ccd0"],  # the shield can is tin-plated steel
    # the vendor model's pins and tabs sit 0.5 mm in front of its own footprint's pads (found by fitting its feet to them)
    "SW-SMD_MK-11C04-G013.step": ["--shift", "0", "0.5"],
}
SKIP = re.compile(r"^R\d")  # resistors: drawn shapes are enough
# parts whose vendor model is wrong: drawn from the datasheet instead (script, centred on the part)
BUILT = {  # drawn here: the vendor models are wrong (E73 proportions) or plain boxes (Raytac)
    "C356849": "make_e73.py",  # EBYTE E73-2G4M08S1C: shield/antenna proportions from its manual
    "C5118826": "make_mdbt50q.py",  # Raytac MDBT50Q-1MV2: from Raytac's 3D drawing, with the can, marking and antenna detail
}
KICAD = "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/"

def get(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "ryong-board3d"})
        with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
        open(path, "wb").write(data)
    return path

# kinds whose body sits centred on its pads (not connectors, switches, sockets or modules)
CENTRED = {"capacitor", "resistor", "inductor", "fuse", "diode", "zener", "esd", "transistor", "ic", "crystal", "led"}

def easyeda_model(lcsc, cache):
    """the part's STEP, and its placement on the EasyEDA footprint (offset mm, KiCad y up; z rotation)"""
    meta = get(f"https://easyeda.com/api/products/{lcsc}/components?version=6.4.19.5", os.path.join(cache, f"{lcsc}.json"))
    data = json.load(open(meta))["result"]["packageDetail"]["dataStr"]
    node = next(json.loads(s.split("~", 1)[1])["attrs"] for s in data["shape"] if s.startswith("SVGNODE"))
    hx, hy = float(data["head"]["x"]), float(data["head"]["y"])
    ox, oy = (float(v) for v in node["c_origin"].split(","))
    off = ((ox - hx) * 0.254, -(oy - hy) * 0.254, 0.0)
    rz = -float(node.get("c_rotation", "0,0,0").split(",")[2])
    # its footprint's pads, model frame (mm, y up): to turn the model onto the board's footprint
    pads = [((float(f[2]) - hx) * 0.254, -(float(f[3]) - hy) * 0.254, f[8]) for f in (s.split("~") for s in data["shape"] if s.startswith("PAD~"))]
    step = get(f"https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{node['uuid']}", os.path.join(cache, node["uuid"] + ".step"))
    return step, off, rz, pads

def best_turn(theirs, ours):
    """The quarter turn that lays EasyEDA's footprint pads onto the board footprint's (both mm, y up).
    The board's footprint can be a turned variant of the one EasyEDA's model was drawn for."""
    if not theirs or not ours: return 0
    num_t = {n: (x, y) for x, y, n in theirs if n}; num_o = {n: (x, y) for x, y, n in ours if n}
    common = set(num_t) & set(num_o)
    def cost(t):
        c, s_ = round(math.cos(math.radians(t))), round(math.sin(math.radians(t)))
        turn = lambda x, y: (x * c - y * s_, x * s_ + y * c)
        if len(common) >= 2:  # numbered pads: pin 1 must land on pin 1 (tells 180° apart)
            return sum(sum((u - v) ** 2 for u, v in zip(turn(*num_t[n]), num_o[n])) for n in common)
        rt = [turn(x, y) for x, y, _ in theirs]
        d = lambda p, q: min((p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2 for r in q)
        return sum(d(p, rt) for p in ours) + sum(d(p, ours) for p in rt)
    return min((0, 90, 180, 270), key=cost)

def pad_shift(theirs, ours, turn, off):
    """The model offset that also lays EasyEDA's pads, turned, onto the board's pads by their centres.
    EasyEDA's model origin and the board footprint's origin need not be the same point."""
    if not theirs or not ours: return off
    num_t = {n: (x, y) for x, y, n in theirs if n}; num_o = {n: (x, y) for x, y, n in ours if n}
    common = sorted(set(num_t) & set(num_o))
    pt, po = ([num_t[n] for n in common], [num_o[n] for n in common]) if len(common) >= 2 else ([(x, y) for x, y, _ in theirs], [(x, y) for x, y, _ in ours])
    c, s_ = round(math.cos(math.radians(turn))), round(math.sin(math.radians(turn)))
    mean = lambda ps: (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps))
    (tx, ty), (ox, oy) = mean(pt), mean(po)
    tx, ty = tx * c - ty * s_, tx * s_ + ty * c  # their pad centre, turned
    dx, dy = ox - tx, oy - ty  # the shift wanted after the turn, back into the model frame before it
    return (off[0] + dx * c + dy * s_, off[1] - dx * s_ + dy * c, off[2])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pcb", required=True); ap.add_argument("--bom", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--cache", required=True)
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    lcsc = {}
    with open(a.bom, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            for ref in re.split(r"[,\s]+", row["Designator"].strip()):
                if ref: lcsc[ref] = row["LCSC Part #"].strip()
    board = parse(open(a.pcb).read())
    jobs = {}  # (model, offset, rotation, footprint for EasyEDA-placed) → refs
    boardpads = {}  # ref → its footprint's pads (mm, model frame: y up)
    for fp in kids(board, "footprint"):
        props = {p[1]: p[2] for p in kids(fp, "property")}
        ref = props.get("Reference", "")
        if ref not in lcsc or SKIP.match(ref): continue
        boardpads[ref] = [(num(kid(p, "at")[1]), -num(kid(p, "at")[2]), p[1]) for p in kids(fp, "pad") if p[2] in ("smd", "thru_hole")]
        if not kids(fp, "model"):  # no model in the design: the part's own, as EasyEDA places it
            jobs.setdefault(("LCSC:" + lcsc[ref], None, 0.0, (fp[1], lcsc[ref])), []).append(ref)
        for m in kids(fp, "model"):
            off = tuple(num(x) for x in kid(kid(m, "offset"), "xyz")[1:]) if kid(m, "offset") else (0, 0, 0)
            rz = num(kid(kid(m, "rotate"), "xyz")[3]) if kid(m, "rotate") else 0.0
            # EasyEDA-placed models are turned onto each footprint's own pads from that part's own EasyEDA footprint,
            # so footprint variants (…-BL, …-TL) and different parts sharing one model each get their own turn
            fpkey = (fp[1], lcsc[ref]) if (m[1].startswith("LCSC:") or "EASYEDA_MODELS" in m[1]) else ""
            jobs.setdefault((m[1], off, rz, fpkey), []).append(ref)
    models, turns = [], {}
    kinds = {p["ref"]: p["kind"] for p in json.load(open(os.path.join(a.out, "board.json")))["parts"]}
    for (path, off, rz, _fp), refs in sorted(jobs.items(), key=lambda j: repr(j[0])):
        name = path.split("/")[-1]
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.splitext(name)[0])[:48]
        tag = hashlib.sha1(repr((path, off, rz)).encode()).hexdigest()[:6]
        out = f"m-{stem}-{tag}.bin"
        turn = 0
        try:
            if lcsc[refs[0]] in BUILT:
                src = os.path.join(a.cache, lcsc[refs[0]] + ".glb")
                subprocess.run([sys.executable, os.path.join(here, BUILT[lcsc[refs[0]]]), os.path.join(a.out, "board.json"), refs[0], src], check=True, capture_output=True)
                part = next(p for p in json.load(open(os.path.join(a.out, "board.json")))["parts"] if p["ref"] == refs[0])
                off, rz = (-part["origin"][0], part["origin"][1], 0.0), 0.0  # part centre from the footprint origin, y up
            elif path.startswith("LCSC:") or "EASYEDA_MODELS" in path:
                # the part's current EasyEDA model, placed on EasyEDA's own footprint, then turned onto ours
                src, off, rz, pads = easyeda_model(lcsc[refs[0]], a.cache)
                turn = best_turn(pads, boardpads[refs[0]])
                off = pad_shift(pads, boardpads[refs[0]], turn, off)
            else:
                rel = re.sub(r"^\$\{[^}]+\}/", "", path)
                rel = re.sub(r"\.wrl$", ".step", rel)  # the library repository keeps STEP sources
                try:
                    src = get(KICAD + rel, os.path.join(a.cache, rel.replace("/", "__")))
                except Exception:  # not in the library any more: the part's own model
                    src, off, rz, pads = easyeda_model(lcsc[refs[0]], a.cache)
                    turn = best_turn(pads, boardpads[refs[0]])
                    off = pad_shift(pads, boardpads[refs[0]], turn, off)
        except Exception as e:
            print(f"skip {name} ({', '.join(refs)}): {e}"); continue
        out = f"m-{stem}-{hashlib.sha1(repr((src, off, rz, turn)).encode()).hexdigest()[:6]}.bin"
        cmd = [sys.executable, os.path.join(here, "convert_model.py"), src, os.path.join(a.out, out),
               "--offset", *map(str, off), "--rotate", str(rz), "--turn", str(turn), *FIXES.get(name, [])]
        if turn is not None and src.endswith(".step") and kinds.get(refs[0]) in CENTRED and boardpads[refs[0]]:
            # EasyEDA's model origin is not always where its footprint says (D2 sat 1.3 mm off, SOT-23s metres off):
            # parts that are symmetric about their pads are simply centred on them
            px = [x for x, _, _ in boardpads[refs[0]]]; py = [y for _, y, _ in boardpads[refs[0]]]
            cmd += ["--centre", str((min(px) + max(px)) / 2), str((min(py) + max(py)) / 2)]
        if os.path.basename(src)[:32].isalnum() and src.endswith(".step"): cmd.append("--no-logo")  # EasyEDA models (cached by uuid)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode: print(f"skip {name}: {r.stderr.strip()[-200:]}"); continue
        path_ = os.path.join(a.out, out)  # gzipped: the host serves .bin as is, the viewer unpacks it
        data = open(path_, "rb").read()
        if data[:2] != b"\x1f\x8b": open(path_, "wb").write(gzip.compress(data, 9, mtime=0))
        size = os.path.getsize(path_)
        print(f"{out}  {size // 1024} KB  {len(refs)} parts" + (f"  turned {turn}°" if turn else ""))
        same = next((m for m in models if m["file"] == out), None)
        if same: same["refs"] += refs
        else: models.append({"file": out, "source": name, "refs": refs})
        for ref in refs: turns[ref] = turn
    json.dump({"models": models}, open(os.path.join(a.out, "models.json"), "w"), indent=1)
    json.dump(turns, open(os.path.join(a.cache, "turns.json"), "w"))  # for checking against the CPL

if __name__ == "__main__":
    main()
