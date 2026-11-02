import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { combo, Ev, FLAVOR_TEXT, holdTap, macroTimeline, MacroItem, Result, tapDance } from "./labEngine";

/**
 * "How it works" + "try it" for one behavior, using the user's own settings.
 * Example mode plays a short timeline like a video; try mode records real presses
 * (mouse, touch or the F / J keys) and shows the result live. Simulation only.
 */
type Lab =
  | { kind: "holdTap"; term: number; flavor: string; quickTap: number; tapLabel: string; holdLabel: string }
  | { kind: "tapDance"; term: number; labels: string[] }
  | { kind: "combo"; timeout: number; keyLabels: string[]; comboLabel: string }
  | { kind: "macro"; steps: MacroItem[]; wait: number; tap: number; name: string };

const PADS = { holdTap: ["a", "o"], tapDance: ["a", "o"], combo: ["a", "b", "c", "d"], macro: ["a"] } as const;
const PHYS: Record<string, string> = { KeyF: "a", KeyJ: "o", KeyK: "c", KeyL: "d" };
type Scenario = { name: string; evs: Ev[] };
const E = (...xs: [string, number, number][]) => xs.map(([k, d, t]) => ({ k, down: !!d, t }));

function simulate(lab: Lab, evs: Ev[], now?: number): Result {
  switch (lab.kind) {
    case "holdTap": return holdTap(evs, { ...lab, otherLabel: "J" }, now);
    case "tapDance": return tapDance(evs, { term: lab.term, labels: lab.labels, otherLabel: "J" }, now);
    case "combo": {
      const keys = ["a", "b", "c", "d"].slice(0, lab.keyLabels.length);
      const labels: Record<string, string> = {};
      keys.forEach((k, i) => (labels[k] = lab.keyLabels[i]));
      return combo(evs.map(e => (lab.keyLabels.length === 2 && e.k === "o" ? { ...e, k: "b" } : e)), { timeout: lab.timeout, keys, labels, comboLabel: lab.comboLabel }, now);
    }
    case "macro": {
      const r = macroTimeline(lab.steps, lab.wait, lab.tap);
      const press = evs.find(e => e.down)?.t;
      if (press === undefined) return { outputs: [], windows: [], notes: r.notes };
      return { outputs: r.outputs.map(o => ({ ...o, t: o.t + press, until: o.until === undefined ? undefined : o.until + press })),
        windows: r.windows.map(w => ({ ...w, from: w.from + press, to: w.to + press })), notes: r.notes };
    }
  }
}

function scenarios(lab: Lab): Scenario[] {
  switch (lab.kind) {
    case "holdTap": {
      const T = lab.term, list: Scenario[] = [
        { name: t("Quick tap", "짧게 누르기"), evs: E(["a", 1, 0], ["a", 0, Math.round(T * 0.45)]) },
        { name: t("Hold", "길게 누르기"), evs: E(["a", 1, 0], ["a", 0, Math.round(T * 1.8)]) },
        { name: t("Hold + another key", "누른 채 다른 키"), evs: E(["a", 1, 0], ["o", 1, Math.round(T * 0.4)], ["o", 0, Math.round(T * 0.65)], ["a", 0, Math.round(T * 0.85)]) },
      ];
      if (lab.quickTap > 0) list.push({ name: t("Tap, then hold again", "탭 후 바로 다시 누르기"), evs: E(["a", 1, 0], ["a", 0, 60], ["a", 1, 60 + Math.round(lab.quickTap * 0.6)], ["a", 0, 60 + Math.round(lab.quickTap * 0.6) + T * 1.5]) });
      return list;
    }
    case "tapDance": {
      const T = lab.term, g = Math.round(T * 0.6), list: Scenario[] = [];
      lab.labels.forEach((_, i) => {
        const evs: Ev[] = [];
        for (let n = 0; n <= i; n++) evs.push({ k: "a", down: true, t: n * g }, { k: "a", down: false, t: n * g + 45 });
        list.push({ name: t("{n}× tap", "{n}번 탭", { n: i + 1 }), evs });
      });
      list.push({ name: t("Tap, then another key", "탭 후 다른 키"), evs: E(["a", 1, 0], ["a", 0, 45], ["o", 1, Math.round(T * 0.5)], ["o", 0, Math.round(T * 0.5) + 60]) });
      return list;
    }
    case "combo": {
      const keys = ["a", "b", "c", "d"].slice(0, lab.keyLabels.length), T = lab.timeout;
      const together: Ev[] = [], slow: Ev[] = [];
      keys.forEach((k, i) => { together.push({ k, down: true, t: Math.round(i * T * 0.35) }, { k, down: false, t: Math.round(T * 2.2 + i * 10) }); });
      keys.forEach((k, i) => { slow.push({ k, down: true, t: Math.round(i * T * 1.6) }, { k, down: false, t: Math.round(i * T * 1.6 + T * 1.2) }); });
      return [
        { name: t("Pressed together", "함께 누르기"), evs: together },
        { name: t("Too far apart", "시간차가 너무 큼"), evs: slow },
        { name: t("Only one key", "한 키만 누르기"), evs: E(["a", 1, 0], ["a", 0, Math.round(T * 1.4)]) },
      ];
    }
    case "macro": return [{ name: t("Press once", "한 번 누르기"), evs: E(["a", 1, 0], ["a", 0, 60]) }];
  }
}

function rule(lab: Lab): string {
  switch (lab.kind) {
    case "holdTap": {
      const f = FLAVOR_TEXT[lab.flavor] ?? FLAVOR_TEXT["hold-preferred"];
      return t("Release within {ms}ms → {tap}. Keep holding → {hold}. {f}", "{ms}ms 안에 떼면 {tap}, 계속 누르고 있으면 {hold}. {f}",
        { ms: lab.term, tap: lab.tapLabel, hold: lab.holdLabel, f: t(f[0], f[1]) });
    }
    case "tapDance":
      return t("Tap again within {ms}ms to move to the next action: ", "{ms}ms 안에 다시 누르면 다음 동작으로 넘어가요: ", { ms: lab.term }) +
        lab.labels.map((l, i) => `${i + 1}× ${l}`).join(" · ");
    case "combo":
      return t("Press {keys} within {ms}ms of each other → {out}. Otherwise each key types itself.", "{keys}를 {ms}ms 안에 함께 누르면 → {out}. 아니면 각 키가 원래대로 입력돼요.",
        { keys: lab.keyLabels.join(" + "), ms: lab.timeout, out: lab.comboLabel });
    case "macro":
      return t("One press sends the whole sequence below, in order.", "한 번 누르면 아래 순서가 차례대로 입력돼요.");
  }
}

const KEY_LABEL = (lab: Lab, k: string) => {
  if (lab.kind === "combo") return lab.keyLabels[["a", "b", "c", "d"].indexOf(k)] ?? k;
  if (lab.kind === "macro") return lab.name || t("Macro key", "매크로 키");
  return k === "a" ? t("This key", "이 키") : t("Other key (J)", "다른 키 (J)");
};

function Timeline({ lab, evs, res, span, head }: { lab: Lab; evs: Ev[]; res: Result; span: number; head: number }) {
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.6, Math.min(100, ((Math.min(b, span) - a) / span) * 100))}%`;
  const keys = lab.kind === "macro" ? ["a"] : [...new Set(evs.map(e => e.k))].sort();
  const bars = (k: string) => {
    const out: { from: number; to: number }[] = [];
    let open: number | undefined;
    for (const e of [...evs].sort((a, b) => a.t - b.t).filter(e => e.k === k)) {
      if (e.down && open === undefined) open = e.t;
      else if (!e.down && open !== undefined) { out.push({ from: open, to: e.t }); open = undefined; }
    }
    if (open !== undefined) out.push({ from: open, to: head });
    return out.filter(b => b.from <= head).map(b => ({ ...b, to: Math.min(b.to, head) }));
  };
  const step = span > 2400 ? 500 : span > 1200 ? 200 : 100;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  return <div className="ry-lab-tl" role="img" aria-label={t("Timeline", "타임라인")}>
    {keys.map(k => <div className="ry-lab-row" key={k}>
      <span className="ry-lab-rowlabel">{KEY_LABEL(lab, k)}</span>
      <div className="ry-lab-track">
        {bars(k).map((b, i) => <span key={i} className={"ry-lab-press" + (k === "a" ? "" : " is-other")} style={{ left: pct(b.from), width: width(b.from, b.to) }} />)}
      </div>
    </div>)}
    {res.windows.length > 0 && <div className="ry-lab-row">
      <span className="ry-lab-rowlabel">{lab.kind === "macro" ? t("Pause", "대기") : t("Deciding", "판정 시간")}</span>
      <div className="ry-lab-track">
        {res.windows.filter(w => w.from <= head).map((w, i) => <span key={i} className="ry-lab-window" style={{ left: pct(w.from), width: width(w.from, w.to) }}><i>{w.label}</i></span>)}
      </div>
    </div>}
    <div className="ry-lab-row is-out">
      <span className="ry-lab-rowlabel">{t("Sends", "입력되는 키")}</span>
      <div className="ry-lab-track">
        {res.outputs.filter(o => o.t <= head).map((o, i) => <span key={i} className={"ry-lab-out is-" + o.kind} style={{ left: pct(o.t), minWidth: o.until && o.until > o.t + 40 ? width(o.t, Math.min(o.until, head)) : undefined }}>
          {o.label}</span>)}
      </div>
    </div>
    <div className="ry-lab-axis">{ticks.map(ms => <span key={ms} style={{ left: pct(ms) }}>{ms}</span>)}<b>ms</b></div>
    <span className="ry-lab-head" style={{ left: `calc(var(--lab-label) + (100% - var(--lab-label)) * ${Math.min(1, head / span)})` }} aria-hidden="true" />
  </div>;
}

function explain(lab: Lab, res: Result): string {
  const outs = res.outputs.filter(o => o.kind !== "other" && o.kind !== "key" || lab.kind === "combo");
  if (!res.outputs.length) return "";
  if (lab.kind === "combo") return res.notes.includes("combo")
    ? t("Pressed together in time → {out}.", "제때 함께 눌러서 → {out}", { out: lab.comboLabel })
    : t("Not together in time, so each key types itself.", "함께 누른 것으로 보지 않아 각 키가 그대로 입력됐어요.");
  if (lab.kind === "macro") return t("Sent {n} inputs in {ms}ms.", "{ms}ms 동안 {n}개 입력", { n: res.outputs.length, ms: res.notes[0] });
  const o = outs[outs.length - 1];
  if (!o) return "";
  if (lab.kind === "tapDance") return t("{n} tap(s) → {out}{held}", "{n}번 → {out}{held}", { n: o.from ?? "", out: o.label, held: o.kind === "hold" ? t(" (held while pressed)", " (누르고 있는 동안 유지)") : "" });
  const why: Record<string, [string, string]> = {
    released: ["released before the term", "판정 시간 전에 떼서"], term: ["held past the term", "판정 시간을 넘겨서"],
    interrupt: ["another key came in", "다른 키가 끼어들어서"], "interrupt-release": ["another key was pressed and released", "다른 키를 눌렀다 떼서"],
    quick: ["pressed again quickly after a tap", "탭 직후 다시 눌러서"],
  };
  const w = why[o.from ?? ""];
  const delayed = res.outputs.some(x => x.from === "delayed");
  return (w ? t(w[0], w[1]) + " → " : "") + o.label + (delayed ? t(" · the other key waited for the decision", " · 다른 키는 판정이 끝난 뒤 입력됐어요") : "");
}

export function BehaviorLab(props: { lab: Lab }) {
  const { lab } = props;
  const list = useMemo(() => scenarios(lab), [JSON.stringify(lab)]);
  const [mode, setMode] = useState<"demo" | "try">("demo");
  const [pick, setPick] = useState(0);
  const sc = list[Math.min(pick, list.length - 1)];
  const demoRes = useMemo(() => simulate(lab, sc.evs), [lab, sc]);
  const demoEnd = Math.max(...sc.evs.map(e => e.t), ...demoRes.outputs.map(o => o.until ?? o.t), ...demoRes.windows.map(w => w.to)) + 60;
  const [head, setHead] = useState(0);
  // Example playback: about 2.5x slower than real time so each step can be followed, then loop.
  useEffect(() => {
    if (mode !== "demo") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setHead(demoEnd); return; }
    let raf = 0, start = performance.now();
    const dur = Math.max(1600, demoEnd * 2.5);
    const tick = (now: number) => {
      const e = now - start;
      if (e > dur + 1400) start = now;
      setHead(Math.min(demoEnd, (Math.min(e, dur) / dur) * demoEnd));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, demoEnd, sc]);

  // Try mode: real presses, live result.
  const [evs, setEvs] = useState<Ev[]>([]);
  const [typed, setTyped] = useState<string[]>([]);
  const t0 = useRef<number | null>(null), down = useRef(new Set<string>()), idle = useRef<number>();
  const [now, setNow] = useState(0);
  const live = mode === "try" && t0.current !== null;
  const span = Math.max(lab.kind === "macro" ? demoEnd : (lab.kind === "combo" ? lab.timeout : lab.term) * 3, now + 120);
  const liveRes = useMemo(() => simulate(lab, evs, down.current.size || lab.kind === "macro" ? now : undefined), [lab, evs, now]);
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => { setNow(performance.now() - t0.current!); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, evs.length]);
  const press = (k: string, isDown: boolean) => {
    if (isDown === down.current.has(k)) return;
    clearTimeout(idle.current);
    const nowAbs = performance.now();
    if (t0.current === null || (isDown && down.current.size === 0 && nowAbs - t0.current > span + 600)) { t0.current = nowAbs; setEvs([]); }
    if (isDown) down.current.add(k); else down.current.delete(k);
    setEvs(e => [...e, { k, down: isDown, t: Math.round(nowAbs - t0.current!) }]);
    if (!isDown && down.current.size === 0) idle.current = window.setTimeout(() => {
      const t1 = performance.now() - (t0.current ?? 0);
      setEvs(e => { const r = simulate(lab, e, undefined); setTyped(x => [...x, ...r.outputs.map(o => o.label)].slice(-24)); return e; });
      setNow(t1); t0.current = null;
    }, (lab.kind === "combo" ? lab.timeout : lab.kind === "macro" ? demoEnd : lab.term) + 250);
  };
  useEffect(() => {
    if (mode !== "try") return;
    const handler = (e: KeyboardEvent) => {
      const k = PHYS[e.code] ?? (lab.kind === "combo" && e.code === "KeyJ" ? "b" : undefined);
      if (!k || (lab.kind !== "combo" && !(PADS[lab.kind] as readonly string[]).includes(k)) || (e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.repeat) { e.preventDefault(); return; }
      e.preventDefault(); press(k, e.type === "keydown");
    };
    window.addEventListener("keydown", handler); window.addEventListener("keyup", handler);
    return () => { window.removeEventListener("keydown", handler); window.removeEventListener("keyup", handler); };
  });
  useEffect(() => () => clearTimeout(idle.current), []);

  const pads = lab.kind === "combo" ? ["a", "b", "c", "d"].slice(0, lab.keyLabels.length) : lab.kind === "macro" ? ["a"] : ["a", "o"];
  const physOf = (k: string) => lab.kind === "combo" ? ["F", "J", "K", "L"][["a", "b", "c", "d"].indexOf(k)] : k === "a" ? "F" : "J";
  const shownEvs = mode === "demo" ? sc.evs : evs;
  const res = mode === "demo" ? demoRes : liveRes;
  const H = mode === "demo" ? head : (t0.current === null ? Infinity : now);
  const S = mode === "demo" ? demoEnd : span;
  return <section className="ry-lab" aria-label={t("How it works", "어떻게 동작하나요")}>
    <div className="ry-lab-top">
      <strong>{t("How it works", "어떻게 동작하나요")}</strong>
      <div className="ry-lab-modes" role="tablist">
        <button role="tab" aria-selected={mode === "demo"} onClick={() => setMode("demo")}>{t("Watch", "예시 보기")}</button>
        <button role="tab" aria-selected={mode === "try"} onClick={() => { setMode("try"); t0.current = null; setEvs([]); }}>{t("Try it", "직접 해보기")}</button>
      </div>
    </div>
    <p className="ry-lab-rule">{rule(lab)}</p>
    {mode === "demo" ? <div className="ry-lab-chips">
      {list.map((s, i) => <button key={i} className="ry-chip" aria-pressed={i === pick} onClick={() => setPick(i)}>{s.name}</button>)}
    </div> : <div className="ry-lab-pads">
      {pads.map(k => <button key={k} className={"ry-lab-pad" + (down.current.has(k) ? " is-down" : "") + (k === "a" || lab.kind === "combo" ? "" : " is-other")}
        onPointerDown={e => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ } press(k, true); }}
        onPointerUp={() => press(k, false)} onPointerCancel={() => press(k, false)}
        onContextMenu={e => e.preventDefault()}>
        <span>{KEY_LABEL(lab, k)}</span><kbd>{physOf(k)}</kbd>
      </button>)}
      <p className="ry-faint">{lab.kind === "combo" ? t("Press the keys with the mouse/touch or the F, J… keys. Try together, then a little apart.", "마우스·터치나 F, J… 키로 눌러 보세요. 동시에, 그리고 조금씩 늦게도 눌러 보세요.")
        : lab.kind === "macro" ? t("Press it to replay the sequence.", "누르면 순서가 다시 재생돼요.")
        : t("Hold with the mouse/touch, or use F (this key) and J (another key).", "마우스·터치로 누르고 있거나, F(이 키)와 J(다른 키)로 눌러 보세요.")}</p>
    </div>}
    <Timeline lab={lab} evs={shownEvs} res={res} span={S} head={Math.min(H, S)} />
    <p className="ry-lab-explain" aria-live="polite">{explain(lab, { ...res, outputs: res.outputs.filter(o => o.t <= H) }) || " "}</p>
    {mode === "try" && <div className="ry-lab-typed">
      <span className="ry-label">{t("Typed so far", "지금까지 입력된 키")}</span>
      <div>{typed.length ? typed.map((x, i) => <kbd key={i}>{x}</kbd>) : <span className="ry-faint">{t("Nothing yet", "아직 없음")}</span>}</div>
      {typed.length > 0 && <button className="ry-text" onClick={() => setTyped([])}>{t("Clear", "지우기")}</button>}
    </div>}
  </section>;
}
