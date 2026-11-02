// Macros, combos and tap dances written by hand in a .keymap file, brought into the editor.
//
// They keep their names (labels), so every key in the keymap that uses them keeps working: the item moves
// out of the .keymap into ryong-behaviors.json/.dtsi, and the keymap includes that file. Anything this
// editor can't express exactly (other behavior types, settings like `&soft_off { … }`, macros with
// unusual controls) stays in the keymap and is listed as such.

import { SETTING_SPECS } from "./model";
import type { Binding, Combo, Macro, MacroStep, Mod, Setting, TapDance } from "./model";

export interface Found {
  kind: "macro" | "combo" | "tapDance" | "setting";
  item: Macro | Combo | TapDance | Setting;
  /** shown in the list */
  title: string;
  /** [start, end) in the keymap text, whole lines */
  span: [number, number];
}
export interface Left {
  /** what it is, e.g. "&soft_off settings", "hold_tap (hold-tap)" */
  what: string;
  /** why it stays, when it could have been one of ours */
  why?: string;
}
export interface Scan {
  found: Found[];
  left: Left[];
}

/** Same length as the text, with comments blanked, so positions line up. */
function mask(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Position of the `}` matching the `{` at `open`. */
function close(m: string, open: number) {
  let d = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === "{") d++;
    else if (m[i] === "}" && --d === 0) return i;
  }
  return -1;
}

interface Node {
  label?: string;
  name: string;
  body: string; // masked
  open: number;
  end: number; // index of `}`
  span: [number, number];
}

/** Direct child nodes of the block whose `{` is at `open`. */
function children(m: string, open: number): Node[] {
  const out: Node[] = [];
  const end = close(m, open);
  let i = open + 1;
  const re = /(?:([A-Za-z_][\w]*)\s*:\s*)?([A-Za-z_][\w,-]*)\s*\{/y;
  while (i < end) {
    if (/\s/.test(m[i]) || m[i] === ";") {
      i++;
      continue;
    }
    re.lastIndex = i;
    const h = re.exec(m);
    if (h) {
      const o = i + h[0].length - 1;
      const c = close(m, o);
      // the node's lines: from the start of its header line to the end of its `};` line
      let s = m.lastIndexOf("\n", i) + 1;
      if (m.slice(s, i).trim()) s = i;
      let e = m.indexOf(";", c);
      e = e < 0 ? c + 1 : e + 1;
      const nl = m.indexOf("\n", e);
      if (nl >= 0 && !m.slice(e, nl).trim()) e = nl + 1;
      out.push({ label: h[1], name: h[2], body: m.slice(o + 1, c), open: o, end: c, span: [s, e] });
      i = c + 1;
    } else {
      // a property: skip to its `;`
      const sc = m.indexOf(";", i);
      i = sc < 0 ? end : sc + 1;
    }
  }
  return out;
}

const prop = (body: string, name: string) => body.match(new RegExp(`(?:^|[\\s;])${name}\\s*=\\s*([^;]*);`))?.[1].trim();
const num = (v?: string) => (v ? Number(v.replace(/[<>\s]/g, "")) : NaN);
const str = (v?: string) => v?.match(/"([^"]*)"/)?.[1];
/** `<&a b &c>, <&d>` → [["&a","b"],["&c"],["&d"]] */
function cells(v?: string): string[][] {
  if (!v) return [];
  const out: string[][] = [];
  for (const t of v.replace(/[<>,]/g, " ").split(/\s+/).filter(Boolean)) {
    if (t.startsWith("&")) out.push([t]);
    else if (out.length) out[out.length - 1].push(t);
  }
  return out;
}

const MODS = new Set(["LC", "LS", "LA", "LG", "RC", "RS", "RA", "RG"]);
function keyWithMods(expr: string): { key: string; mods: Mod[] } | null {
  const mods: Mod[] = [];
  let e = expr.trim();
  for (;;) {
    const m = e.match(/^([A-Z]{2})\((.*)\)$/);
    if (!m) break;
    if (!MODS.has(m[1])) return null;
    mods.push(m[1] as Mod);
    e = m[2].trim();
  }
  return /^[A-Z0-9_]+$/.test(e) ? { key: e, mods } : null;
}

function binding(cell: string[], ours: Set<string>, defines: Record<string, string>): Binding {
  const [amp, ...args] = cell;
  const b = amp.slice(1);
  const raw: Binding = { b: "raw", text: cell.join(" ") };
  if ((b === "kp" || b === "sk") && args.length === 1) {
    const k = keyWithMods(args[0]);
    return k ? { b, key: k.key, ...(k.mods.length ? { mods: k.mods } : {}) } : raw;
  }
  if (["mo", "tog", "to", "sl"].includes(b) && args.length === 1) {
    const n = Number(defines[args[0]] ?? args[0]);
    return Number.isInteger(n) ? { b: b as "mo", layer: n } : raw;
  }
  if (b === "bt" && args.length) return { b: "bt", cmd: args.join(" ") };
  if (b === "out" && args.length === 1) return { b: "out", cmd: args[0] };
  if (!args.length && ["trans", "none", "caps_word", "key_repeat", "studio_unlock", "bootloader", "sys_reset"].includes(b)) return { b: b as "trans" };
  if (!args.length && ours.has(b)) return { b: "ref", id: b };
  return raw;
}

function macro(n: Node, ours: Set<string>, defines: Record<string, string>): Macro | string {
  if ((prop(n.body, "#binding-cells") || "").replace(/\D/g, "") !== "0") return "takes parameters";
  const steps: MacroStep[] = [];
  let mode: "tap" | "press" | "release" = "tap";
  for (const c of cells(prop(n.body, "bindings"))) {
    const b = c[0];
    if (b === "&macro_tap") mode = "tap";
    else if (b === "&macro_press") mode = "press";
    else if (b === "&macro_release") mode = "release";
    else if (b === "&macro_wait_time") steps.push({ t: "wait", ms: num(c[1]) || 0 });
    else if (b.startsWith("&macro_")) return `uses ${b}`;
    else steps.push({ t: mode, binding: binding(c, ours, defines) });
  }
  if (!steps.length) return "is empty";
  const id = n.label || n.name;
  return {
    id,
    name: str(prop(n.body, "display-name")) || str(prop(n.body, "label")) || id,
    wait: num(prop(n.body, "wait-ms")) || 15,
    tap: num(prop(n.body, "tap-ms")) || 30,
    steps,
  };
}

function combo(n: Node, ours: Set<string>, defines: Record<string, string>): Combo | string {
  const keys = (prop(n.body, "key-positions") || "").replace(/[<>]/g, " ").split(/\s+/).filter(Boolean).map((k) => Number(defines[k] ?? k));
  const bs = cells(prop(n.body, "bindings"));
  if (keys.length < 2 || keys.some((k) => !Number.isInteger(k)) || bs.length !== 1) return "has an unusual shape";
  if (/require-prior-idle-ms|slow-release/.test(n.body)) return "uses extra options";
  const layers = (prop(n.body, "layers") || "").replace(/[<>]/g, " ").split(/\s+/).filter(Boolean).map((l) => Number(defines[l] ?? l));
  return {
    id: n.name.replace(/[^\w]/g, "_"),
    name: n.name,
    keys,
    layers: layers.filter((l) => Number.isInteger(l)),
    timeout: num(prop(n.body, "timeout-ms")) || 50,
    binding: binding(bs[0], ours, defines),
  };
}

function tapDance(n: Node, ours: Set<string>, defines: Record<string, string>): TapDance | string {
  const bs = cells(prop(n.body, "bindings"));
  if (bs.length < 2) return "has fewer than 2 taps";
  const id = n.label || n.name;
  return {
    id,
    name: str(prop(n.body, "display-name")) || str(prop(n.body, "label")) || id,
    term: num(prop(n.body, "tapping-term-ms")) || 200,
    bindings: bs.map((c) => binding(c, ours, defines)),
  };
}

/** What a keymap defines by hand. `taken`: ids the editor already has (left alone). */
export function scanKeymap(text: string, taken: Set<string> = new Set(), takenSettings: Set<string> = new Set()): Scan {
  const m = mask(text);
  const defines: Record<string, string> = {};
  for (const d of m.matchAll(/^\s*#define\s+(\w+)\s+(\S+)/gm)) defines[d[1]] = d[2];
  const found: Found[] = [];
  const left: Left[] = [];

  // options for behaviors ZMK already has: `&soft_off { hold-time-ms = <3000>; };` at the top level
  for (const s of m.matchAll(/^[ \t]*&([\w]+)\s*\{/gm)) {
    const b = s[1];
    const o = (s.index ?? 0) + s[0].length - 1;
    const c = close(m, o);
    const spec = SETTING_SPECS[b];
    const body = m.slice(o + 1, c);
    const props: Record<string, number | string> = {};
    let ok = !!spec && !takenSettings.has(b);
    for (const p of body.split(";").map((x) => x.trim()).filter(Boolean)) {
      const kv = p.match(/^([\w-]+)\s*=\s*(.+)$/);
      const ps = kv && spec?.props[kv[1]];
      if (!kv || !ps) {
        ok = false;
        break;
      }
      const v = typeof ps.def === "number" ? num(kv[2]) : str(kv[2]);
      if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) {
        ok = false;
        break;
      }
      props[kv[1]] = v;
    }
    if (!ok || !Object.keys(props).length) {
      left.push({ what: `&${b}`, why: spec ? "has options this page can't edit" : undefined });
      continue;
    }
    let st = m.lastIndexOf("\n", s.index ?? 0) + 1;
    if (m.slice(st, (s.index ?? 0)).trim()) st = s.index ?? 0;
    let e = m.indexOf(";", c);
    e = e < 0 ? c + 1 : e + 1;
    const nl = m.indexOf("\n", e);
    if (nl >= 0 && !m.slice(e, nl).trim()) e = nl + 1;
    found.push({ kind: "setting", item: { behavior: b, props }, title: `&${b}`, span: [st, e] });
  }

  // every root block `/ { … };`
  const roots: number[] = [];
  for (const r of m.matchAll(/\/\s*\{/g)) roots.push((r.index ?? 0) + r[0].length - 1);

  // first pass: names of everything we might take, so references between them become links
  const groups: { kind: "macros" | "combos" | "behaviors"; nodes: Node[] }[] = [];
  for (const o of roots) {
    for (const n of children(m, o)) {
      if (n.name === "macros" || n.name === "behaviors") groups.push({ kind: n.name, nodes: children(m, n.open) });
      else if (n.name === "combos" && /"zmk,combos"/.test(n.body)) groups.push({ kind: "combos", nodes: children(m, n.open) });
    }
  }
  const ours = new Set<string>();
  for (const g of groups)
    for (const n of g.nodes) {
      const compat = str(prop(n.body, "compatible"));
      if (compat === "zmk,behavior-macro" || compat === "zmk,behavior-tap-dance") ours.add(n.label || n.name);
    }

  for (const g of groups) {
    for (const n of g.nodes) {
      const compat = str(prop(n.body, "compatible"));
      const id = n.label || n.name;
      if (taken.has(id) || taken.has(n.name)) continue;
      let r: Macro | Combo | TapDance | string;
      let kind: Found["kind"];
      if (g.kind === "combos") {
        kind = "combo";
        r = combo(n, ours, defines);
      } else if (compat === "zmk,behavior-macro") {
        kind = "macro";
        r = macro(n, ours, defines);
      } else if (compat === "zmk,behavior-tap-dance") {
        kind = "tapDance";
        r = tapDance(n, ours, defines);
      } else {
        left.push({ what: `${id}${compat ? ` (${compat.replace(/^zmk,behavior-/, "")})` : ""}` });
        continue;
      }
      if (typeof r === "string") left.push({ what: id, why: r });
      else found.push({ kind, item: r, title: r.name, span: n.span });
    }
  }
  // a reference to something that stays in the keymap is fine (raw binding); one to an item that couldn't
  // come over must not become a dangling link
  const moving = new Set(found.map((f) => ("id" in f.item ? f.item.id : "")));
  const fix = (b: Binding): Binding => (b.b === "ref" && !moving.has(b.id) ? { b: "raw", text: `&${b.id}` } : b);
  for (const f of found) {
    if (f.kind === "combo") (f.item as Combo).binding = fix((f.item as Combo).binding);
    if (f.kind === "tapDance") (f.item as TapDance).bindings = (f.item as TapDance).bindings.map(fix);
    if (f.kind === "macro") (f.item as Macro).steps = (f.item as Macro).steps.map((s) => ("binding" in s ? { ...s, binding: fix(s.binding) } : s));
  }
  return { found, left };
}

/** The keymap without the moved items; a `macros`/`combos`/`behaviors` block left empty goes too. */
export function removeFound(text: string, found: Found[]): string {
  let out = text;
  for (const f of [...found].sort((a, b) => b.span[0] - a.span[0])) out = out.slice(0, f.span[0]) + out.slice(f.span[1]);
  // drop blocks that are now empty (only whitespace, comments or a compatible line)
  for (;;) {
    const m = mask(out);
    let changed = false;
    for (const b of m.matchAll(/(^[ \t]*)(macros|combos|behaviors)\s*\{/gm)) {
      const o = (b.index ?? 0) + b[0].length - 1;
      const c = close(m, o);
      if (c < 0) continue;
      const inner = m.slice(o + 1, c).replace(/compatible\s*=\s*"[^"]*"\s*;/, "");
      if (inner.trim()) continue;
      let s = b.index ?? 0;
      let e = m.indexOf(";", c);
      e = e < 0 ? c + 1 : e + 1;
      const nl = m.indexOf("\n", e);
      if (nl >= 0 && !m.slice(e, nl).trim()) e = nl + 1;
      // a blank line left behind right before it goes too
      if (out.slice(Math.max(0, s - 2), s) === "\n\n") s -= 1;
      out = out.slice(0, s) + out.slice(e);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return out;
}
