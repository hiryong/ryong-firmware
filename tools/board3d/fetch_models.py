"""Real 3D models for the parts on the board, placed the way the board's KiCad file places them.

  python3 fetch_models.py --pcb board.kicad_pcb --bom BOM.csv --out <board3d dir> --cache <dir>

For each footprint the factory assembles, the KiCad file names a 3D model and its offset/rotation:
- EASYEDA_MODELS/*.step: the part's own LCSC/EasyEDA model, fetched by its LCSC number
  (easyeda.com component API → modules.easyeda.com STEP). EasyEDA's z offset is ignored: its STEP
  models already sit on z = 0 (the board face), and the exported z sinks them into the board.
- ${KICAD*_3DMODEL_DIR}/<lib>.3dshapes/<name>: KiCad's official model (kicad-packages3D, its .step).
Resistors are left as drawn shapes (plain 0402 chips). Each model becomes <name>.bin (convert_model.py);
models.json maps it to the parts that use it. Per-model fixes (a logo cut into a part, a plastic
colour that should match the real part) are in FIXES.
"""
import argparse, csv, hashlib, json, os, re, subprocess, sys, urllib.request
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from sexpr import parse, kids, kid, num

FIXES = {  # model file name → extra convert_model.py arguments
    # purple, as in the LCSC photo; the logo cut into its side covered (filling it still shows the letters)
    "SMD_KEYBOARD-SW.step": ["--recolor", "#230092=#5a50b4", "--cover", "1.4", "1.05", "0.38", "3.75", "1.062", "1.18", "#230092"],
    "WIRELM-SMD_L18.0-W13.0-H3.0-E73-2G4M08S1C.step": ["--recolor", "#60574e=#c9ccd0"],  # the shield can is tin-plated steel
}
SKIP = re.compile(r"^R\d")  # resistors: drawn shapes are enough
KICAD = "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/"

def get(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "ryong-board3d"})
        with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
        open(path, "wb").write(data)
    return path

def easyeda_model(lcsc, cache):
    """the part's STEP, and its placement on the EasyEDA footprint (offset mm, KiCad y up; z rotation)"""
    meta = get(f"https://easyeda.com/api/products/{lcsc}/components?version=6.4.19.5", os.path.join(cache, f"{lcsc}.json"))
    data = json.load(open(meta))["result"]["packageDetail"]["dataStr"]
    node = next(json.loads(s.split("~", 1)[1])["attrs"] for s in data["shape"] if s.startswith("SVGNODE"))
    ox, oy = (float(v) for v in node["c_origin"].split(","))
    off = ((ox - float(data["head"]["x"])) * 0.254, -(oy - float(data["head"]["y"])) * 0.254, 0.0)
    rz = -float(node.get("c_rotation", "0,0,0").split(",")[2])
    step = get(f"https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/{node['uuid']}", os.path.join(cache, node["uuid"] + ".step"))
    return step, off, rz

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
    jobs = {}  # (model, offset, rotation) → refs
    for fp in kids(board, "footprint"):
        props = {p[1]: p[2] for p in kids(fp, "property")}
        ref = props.get("Reference", "")
        if ref not in lcsc or SKIP.match(ref): continue
        if not kids(fp, "model"):  # no model in the design: the part's own, as EasyEDA places it
            jobs.setdefault(("LCSC:" + lcsc[ref], None, 0.0), []).append(ref)
        for m in kids(fp, "model"):
            off = tuple(num(x) for x in kid(kid(m, "offset"), "xyz")[1:]) if kid(m, "offset") else (0, 0, 0)
            rz = num(kid(kid(m, "rotate"), "xyz")[3]) if kid(m, "rotate") else 0.0
            jobs.setdefault((m[1], off, rz), []).append(ref)
    models = []
    for (path, off, rz), refs in sorted(jobs.items()):
        name = path.split("/")[-1]
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.splitext(name)[0])[:48]
        tag = hashlib.sha1(repr((path, off, rz)).encode()).hexdigest()[:6]
        out = f"m-{stem}-{tag}.bin"
        try:
            if path.startswith("LCSC:"):
                src, off, rz = easyeda_model(lcsc[refs[0]], a.cache)
            elif "EASYEDA_MODELS" in path:
                src = easyeda_model(lcsc[refs[0]], a.cache)[0]; off = (off[0], off[1], 0.0)
            else:
                rel = re.sub(r"^\$\{[^}]+\}/", "", path)
                rel = re.sub(r"\.wrl$", ".step", rel)  # the library repository keeps STEP sources
                try:
                    src = get(KICAD + rel, os.path.join(a.cache, rel.replace("/", "__")))
                except Exception:  # not in the library any more: the part's own model
                    src, off, rz = easyeda_model(lcsc[refs[0]], a.cache)
        except Exception as e:
            print(f"skip {name} ({', '.join(refs)}): {e}"); continue
        cmd = [sys.executable, os.path.join(here, "convert_model.py"), src, os.path.join(a.out, out),
               "--offset", *map(str, off), "--rotate", str(rz), *FIXES.get(name, [])]
        if os.path.basename(src)[:32].isalnum(): cmd.append("--no-logo")  # EasyEDA models (cached by uuid)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode: print(f"skip {name}: {r.stderr.strip()[-200:]}"); continue
        size = os.path.getsize(os.path.join(a.out, out))
        print(f"{out}  {size // 1024} KB  {len(refs)} parts")
        models.append({"file": out, "source": name, "refs": refs})
    json.dump({"models": models}, open(os.path.join(a.out, "models.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
