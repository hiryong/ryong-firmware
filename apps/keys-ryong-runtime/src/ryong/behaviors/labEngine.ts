/**
 * Plain-language simulator for ZMK timing behaviors, used by the "try it" labs.
 * Pure functions: given key presses (ms) and the user's settings, return what the
 * keyboard would send and when. Mirrors ZMK's documented rules; it is an explanation
 * aid, not a substitute for testing on the real keyboard.
 */
export type Ev = { k: string; down: boolean; t: number };
export type OutKind = "tap" | "hold" | "other" | "combo" | "key" | "text";
export type Out = { t: number; until?: number; label: string; kind: OutKind; from?: string };
export type Span = { from: number; to: number; label: string };
export type Result = { outputs: Out[]; windows: Span[]; notes: string[] };

type Press = { k: string; down: number; up?: number };
function presses(evs: Ev[]): Press[] {
  const out: Press[] = [], open = new Map<string, Press>();
  for (const e of [...evs].sort((a, b) => a.t - b.t)) {
    if (e.down) { if (!open.has(e.k)) { const p = { k: e.k, down: e.t }; open.set(e.k, p); out.push(p); } }
    else { const p = open.get(e.k); if (p) { p.up = e.t; open.delete(e.k); } }
  }
  return out;
}

export const FLAVOR_TEXT: Record<string, [string, string]> = {
  "hold-preferred": ["Another key pressed while held → hold.", "누르고 있는 동안 다른 키를 누르면 바로 홀드."],
  "balanced": ["Another key pressed and released while held → hold.", "누르고 있는 동안 다른 키를 눌렀다 떼면 홀드."],
  "tap-preferred": ["Only time decides: hold only after the term.", "시간만 봅니다. 판정 시간을 넘겨야 홀드."],
  "tap-unless-interrupted": ["Hold only when another key interrupts.", "다른 키가 끼어들 때만 홀드."],
};

export type HoldTapOpts = { term: number; flavor: string; quickTap: number; tapLabel: string; holdLabel: string; otherLabel: string };
/** `now` is the current time for a live session (undefined = everything finished). */
export function holdTap(evs: Ev[], o: HoldTapOpts, now?: number): Result {
  const all = presses(evs), outputs: Out[] = [], windows: Span[] = [], notes: string[] = [];
  let lastTapUp = -Infinity;
  const decisions: { from: number; at: number }[] = [];
  for (const p of all.filter(x => x.k === "a")) {
    const end = p.up ?? now ?? Infinity, deadline = p.down + o.term;
    windows.push({ from: p.down, to: deadline, label: `${o.term}ms` });
    const others = all.filter(x => x.k !== "a" && x.down > p.down && x.down < Math.min(end, deadline));
    let kind: "tap" | "hold" | null = null, at = 0, why = "";
    if (o.quickTap > 0 && p.down - lastTapUp < o.quickTap) { kind = "tap"; at = p.down; why = "quick"; }
    else if (o.flavor === "hold-preferred" && others.length) { kind = "hold"; at = others[0].down; why = "interrupt"; }
    else if (o.flavor === "balanced" && others.some(x => x.up !== undefined && x.up < Math.min(end, deadline))) {
      kind = "hold"; at = others.find(x => x.up !== undefined && x.up < Math.min(end, deadline))!.up!; why = "interrupt-release";
    } else if (o.flavor === "tap-unless-interrupted" && others.length) { kind = "hold"; at = others[0].down; why = "interrupt"; }
    else if (p.up !== undefined && p.up < deadline) { kind = "tap"; at = p.up; why = "released"; }
    else if (deadline <= (now ?? Infinity) || p.up !== undefined) {
      kind = o.flavor === "tap-unless-interrupted" ? "tap" : "hold"; at = deadline; why = "term";
    }
    if (!kind) continue; // still deciding (live)
    decisions.push({ from: p.down, at });
    outputs.push({ t: at, until: kind === "tap" && why === "released" ? at + 30 : p.up, label: kind === "tap" ? o.tapLabel : o.holdLabel, kind, from: why });
    if (kind === "tap") lastTapUp = p.up ?? at;
    notes.push(why);
  }
  // Other keys wait until a pending hold-tap above them is decided.
  for (const x of all.filter(x => x.k !== "a")) {
    const pending = all.find(p => p.k === "a" && p.down < x.down && (p.up ?? Infinity) > x.down);
    const decided = pending ? decisions.find(d => d.from === pending.down) : undefined;
    if (pending && !decided) continue;
    const at = decided ? Math.max(x.down, decided.at) : x.down;
    outputs.push({ t: at, until: x.up, label: o.otherLabel, kind: "other", from: at > x.down ? "delayed" : "" });
  }
  outputs.sort((a, b) => a.t - b.t);
  return { outputs, windows, notes };
}

export type TapDanceOpts = { term: number; labels: string[]; otherLabel?: string };
export function tapDance(evs: Ev[], o: TapDanceOpts, now?: number): Result {
  const all = presses(evs), outputs: Out[] = [], windows: Span[] = [], notes: string[] = [];
  const max = Math.max(1, o.labels.length);
  let group: Press[] = [];
  const flush = (at: number, why: string) => {
    if (!group.length) return;
    const n = group.length, last = group[n - 1];
    const held = last.up === undefined || last.up > at;
    outputs.push({ t: at, until: held ? last.up : at + 30, label: o.labels[n - 1] ?? "", kind: held && why === "term" ? "hold" : "tap", from: `${n}` });
    notes.push(`${n}:${why}`);
    group = [];
  };
  for (const p of all) {
    if (p.k !== "a") {
      if (group.length) flush(p.down, "interrupt");
      outputs.push({ t: p.down, until: p.up, label: o.otherLabel ?? "J", kind: "other" });
      continue;
    }
    if (group.length && p.down > group[group.length - 1].down + o.term) flush(group[group.length - 1].down + o.term, "term");
    group.push(p);
    windows.push({ from: p.down, to: p.down + o.term, label: `${group.length}` });
    if (group.length >= max) flush(p.down, "max");
  }
  if (group.length) {
    const deadline = group[group.length - 1].down + o.term;
    if (now === undefined || now >= deadline) flush(deadline, "term");
  }
  outputs.sort((a, b) => a.t - b.t);
  return { outputs, windows, notes };
}

export type ComboOpts = { timeout: number; keys: string[]; labels: Record<string, string>; comboLabel: string };
export function combo(evs: Ev[], o: ComboOpts, now?: number): Result {
  const all = presses(evs), outputs: Out[] = [], windows: Span[] = [], notes: string[] = [];
  let i = 0;
  while (i < all.length) {
    const first = all[i];
    if (!o.keys.includes(first.k)) { outputs.push({ t: first.down, until: first.up, label: o.labels[first.k] ?? first.k, kind: "key" }); i++; continue; }
    const deadline = first.down + o.timeout;
    windows.push({ from: first.down, to: deadline, label: `${o.timeout}ms` });
    const group = [first];
    let j = i + 1, broken: number | undefined;
    for (; j < all.length && all[j].down < deadline; j++) {
      if (!o.keys.includes(all[j].k) || group.some(g => g.k === all[j].k)) { broken = all[j].down; break; }
      if (group.some(g => g.up !== undefined && g.up < all[j].down)) { broken = Math.min(...group.map(g => g.up ?? Infinity)); break; }
      group.push(all[j]);
      if (group.length === o.keys.length) break;
    }
    if (group.length === o.keys.length) {
      const at = group[group.length - 1].down;
      outputs.push({ t: at, until: Math.min(...group.map(g => g.up ?? Infinity)), label: o.comboLabel, kind: "combo" });
      notes.push("combo"); i = j + 1; continue;
    }
    const releasedEarly = Math.min(...group.map(g => g.up ?? Infinity));
    const at = Math.min(broken ?? Infinity, releasedEarly, deadline);
    if (at === Infinity || (now !== undefined && at > now)) break; // live: still waiting
    for (const g of group) outputs.push({ t: Math.max(g.down, at), until: g.up, label: o.labels[g.k] ?? g.k, kind: "key", from: "split" });
    notes.push(at === deadline ? "timeout" : "broken");
    i += group.length;
  }
  outputs.sort((a, b) => a.t - b.t);
  return { outputs, windows, notes };
}

export type MacroItem = { kind: "tap" | "press" | "release" | "wait" | "text"; label: string; ms?: number };
/** Turns macro steps into a timeline: each tap is held tap-ms, then wait-ms before the next. */
export function macroTimeline(steps: MacroItem[], wait: number, tap: number): Result {
  const outputs: Out[] = [], windows: Span[] = [];
  let t = 0;
  const held = new Map<string, Out>();
  for (const s of steps) {
    if (s.kind === "wait") { windows.push({ from: t, to: t + (s.ms ?? 0), label: `${s.ms}ms` }); t += s.ms ?? 0; continue; }
    if (s.kind === "text") {
      for (const ch of [...s.label].slice(0, 40)) { outputs.push({ t, until: t + Math.max(tap, 8), label: ch === " " ? "␣" : ch, kind: "text" }); t += Math.max(tap, 8) + wait; }
      continue;
    }
    if (s.kind === "press") { const out = { t, until: undefined, label: s.label, kind: "hold" as OutKind }; held.set(s.label, out); outputs.push(out); t += wait; continue; }
    if (s.kind === "release") { const h = held.get(s.label); if (h) h.until = t; held.delete(s.label); t += wait; continue; }
    outputs.push({ t, until: t + Math.max(tap, 8), label: s.label, kind: "tap" }); t += Math.max(tap, 8) + wait;
  }
  for (const h of held.values()) h.until = t;
  return { outputs, windows, notes: [`${t}`] };
}
