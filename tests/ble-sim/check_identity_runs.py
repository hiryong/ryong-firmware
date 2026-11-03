"""Judge the identity scenarios without exact snapshots (addresses differ by design): the keyboard
must not crash or hang, and each simulated computer must end up as in ZMK's own expected result for
the same scenario: paired or refused, and receiving key reports or not (a computer whose profile is
cleared or not selected gets none). Argument 3: ZMK's upstream case directory (with snapshot.log)."""
import re, sys
from pathlib import Path

build, cases = Path(sys.argv[1]), Path(sys.argv[2])
upstream = Path(sys.argv[3]) if len(sys.argv) > 3 else None


def expected(case: str, d: str):
    """(paired, got keys) for device d in ZMK's snapshot of the upstream case, or None."""
    snap = upstream / case / "snapshot.log" if upstream else None
    if not snap or not snap.exists():
        return None
    tag = f"profile {int(d[2:]) - 2} "
    lines = [l for l in snap.read_text().splitlines() if l.startswith(tag)]
    return any("Pairing complete" in l for l in lines), any("notify_func: payload" in l for l in lines)


def filtered(case: str, d: str):
    """The same as expected(), from our run filtered with the case's own patterns (some cases keep
    only the key reports in their snapshot)."""
    f = build / case / "filtered_output.log"
    if not f.exists():
        return None
    tag = f"profile {int(d[2:]) - 2} "
    lines = [l for l in f.read_text(errors="replace").splitlines() if l.startswith(tag)]
    return any("Pairing complete" in l for l in lines), any("notify_func: payload" in l for l in lines)


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
        want, have = expected(case, d), filtered(case, d)
        if want is not None and have is not None:
            if have != want:
                problems.append(f"{d} expected {'paired' if want[0] else 'not shown paired'}{', keys' if want[1] else ', no keys'}")
        elif want is None:
            if paired and not got:
                problems.append(f"{d} paired but got no keys")
        elif (paired, got) != want:
            problems.append(f"{d} expected {'paired' if want[0] else 'not paired'}{', keys' if want[1] else ', no keys'}")
    if not any("Pairing complete" in l for l in text.splitlines()):
        problems.append("no computer paired (keyboard hung or never advertised?)")
    ok = not problems
    bad += 0 if ok else 1
    print(f"| {case} | {'PASS' if ok else 'FAIL'} | {'; '.join(problems) or ''} {' / '.join(notes)} |")
sys.exit(1 if bad else 0)
