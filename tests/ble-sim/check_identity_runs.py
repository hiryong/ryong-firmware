"""Judge the identity scenarios without snapshots: the keyboard must not crash or hang, and every
simulated computer that paired must receive key reports."""
import re, sys
from pathlib import Path

build, cases = Path(sys.argv[1]), Path(sys.argv[2])
bad = 0
print("### Identity scenarios (one Bluetooth identity per profile)")
print("| scenario | result | details |")
print("|---|---|---|")
for case in sorted(p.name for p in cases.iterdir() if p.is_dir()):
    log = build / case / "output.log"
    if not log.exists():
        print(f"| {case} | FAIL | did not build or run |"); bad += 1; continue
    text = log.read_text(errors="replace")
    problems = [w for w in ("FATAL", "ASSERTION FAIL", "Stack overflow", "Kernel panic", "Fault") if w in text]
    centrals = sorted(set(re.findall(r"^(d_0[2-9]):", text, re.M)))
    notes = []
    for d in centrals:
        lines = [l for l in text.splitlines() if l.startswith(d + ":")]
        paired = any("Pairing complete" in l for l in lines)
        got = any("notify_func: payload" in l for l in lines)
        notes.append(f"{d}: {'paired' if paired else 'not paired'}{', got keys' if got else ''}")
        if paired and not got:
            problems.append(f"{d} paired but got no keys")
    if not any("Pairing complete" in l for l in text.splitlines()):
        problems.append("no computer paired (keyboard hung or never advertised?)")
    ok = not problems
    bad += 0 if ok else 1
    print(f"| {case} | {'PASS' if ok else 'FAIL'} | {'; '.join(problems) or ''} {' / '.join(notes)} |")
sys.exit(1 if bad else 0)
