// Combos, macros and tap-dances that keys.ryong.com manages.
//
// ZMK Studio can assign behaviors to keys live, but it cannot *define* new ones — those live in the
// firmware's devicetree. So this editor keeps its own source of truth (ryong-behaviors.json) next to the
// keyboard's .keymap file in GitHub, generates ryong-behaviors.dtsi from it, and the keymap includes that
// file. Saving commits both files; GitHub Actions builds new firmware; after flashing, the macros and
// tap-dances show up in Studio's behavior list and the combos just work.

import { t } from "../i18n";
export type Mod = "LC" | "LS" | "LA" | "LG" | "RC" | "RS" | "RA" | "RG";

export type Binding =
  | { b: "kp" | "sk"; key: string; mods?: Mod[] }
  | { b: "mo" | "tog" | "to" | "sl"; layer: number }
  | { b: "bt"; cmd: string }
  | { b: "out"; cmd: string }
  | { b: "trans" | "none" | "caps_word" | "key_repeat" | "studio_unlock" | "bootloader" | "sys_reset" }
  | { b: "ref"; id: string }
  | { b: "raw"; text: string };

export type MacroStep =
  | { t: "tap" | "press" | "release"; binding: Binding }
  | { t: "wait"; ms: number }
  | { t: "text"; text: string };

export interface Combo {
  id: string;
  name: string;
  keys: number[];
  /** empty = every layer */
  layers: number[];
  timeout: number;
  binding: Binding;
}

export interface Macro {
  id: string;
  name: string;
  wait: number;
  tap: number;
  steps: MacroStep[];
}

export interface TapDance {
  id: string;
  name: string;
  term: number;
  bindings: Binding[];
}

/** New values for options of behaviors ZMK already has, e.g. how long Soft Off must be held. */
export interface Setting {
  behavior: string;
  props: Record<string, number | string>;
}

export interface BehaviorDoc {
  format: "ryong-behaviors";
  version: 1;
  combos: Combo[];
  macros: Macro[];
  tapDances: TapDance[];
  settings: Setting[];
}

export const emptyDoc = (): BehaviorDoc => ({ format: "ryong-behaviors", version: 1, combos: [], macros: [], tapDances: [], settings: [] });

// The options this editor knows. Anything else stays in the keymap file.
export type SettingProp = { label: () => string; hint?: () => string; def: number | string; options?: string[]; min?: number; max?: number };
export const FLAVORS = ["hold-preferred", "balanced", "tap-preferred", "tap-unless-interrupted"];
const holdTapProps = (): Record<string, SettingProp> => ({
  "tapping-term-ms": { label: () => "tapping-term-ms", hint: () => t("Held longer than this = hold.", "이보다 오래 누르면 홀드예요."), def: 200, min: 50, max: 2000 },
  "quick-tap-ms": { label: () => "quick-tap-ms", hint: () => t("Tap, then hold within this time to repeat the key.", "이 시간 안에 다시 눌러서 누르고 있으면 키가 반복돼요."), def: 0, min: 0, max: 1000 },
  "require-prior-idle-ms": { label: () => "require-prior-idle-ms", hint: () => t("Pressed this soon after another key = always a tap.", "다른 키를 누르고 이 시간 안에 누르면 항상 탭으로 처리해요."), def: 0, min: 0, max: 1000 },
  flavor: { label: () => "flavor", def: "hold-preferred", options: FLAVORS },
});
export const SETTING_SPECS: Record<string, { name: () => string; props: Record<string, SettingProp> }> = {
  soft_off: {
    name: () => "Soft Off",
    props: { "hold-time-ms": { label: () => "hold-time-ms", def: 0, min: 0, max: 10000 } },
  },
  lt: { name: () => "Layer-Tap", props: holdTapProps() },
  mt: { name: () => "Mod-Tap", props: holdTapProps() },
  sk: {
    name: () => "Sticky Key",
    props: { "release-after-ms": { label: () => "release-after-ms", def: 1000, min: 100, max: 10000 } },
  },
  sl: {
    name: () => "Sticky Layer",
    props: { "release-after-ms": { label: () => "release-after-ms", def: 1000, min: 100, max: 10000 } },
  },
};

export const MOD_LABEL: Record<Mod, string> = {
  LC: "Ctrl", LS: "Shift", LA: "Alt", LG: "GUI", RC: "R Ctrl", RS: "R Shift", RA: "R Alt", RG: "R GUI",
};

export const BT_CMDS = [
  "BT_SEL 0", "BT_SEL 1", "BT_SEL 2", "BT_SEL 3", "BT_SEL 4",
  "BT_DISC 0", "BT_DISC 1", "BT_DISC 2", "BT_DISC 3", "BT_DISC 4",
  "BT_NXT", "BT_PRV", "BT_CLR", "BT_CLR_ALL",
];
/** ZMK's own names for the Bluetooth commands (as the key editor shows them) */
export function btLabel(cmd: string): string {
  const [c, n] = cmd.split(" ");
  const names: Record<string, string> = {
    BT_SEL: "Select Profile",
    BT_DISC: "Disconnect Profile",
    BT_NXT: "Next Profile",
    BT_PRV: "Previous Profile",
    BT_CLR: "Clear Selected Profile",
    BT_CLR_ALL: "Clear All Profiles",
  };
  return names[c] ? (n !== undefined ? `${names[c]} ${n}` : names[c]) : cmd;
}

/** ZMK's own names for the output commands */
export const outLabel = (cmd: string) =>
  ({ OUT_TOG: "Toggle Outputs", OUT_USB: "USB Output", OUT_BLE: "BLE Output", OUT_NONE: "No Output" })[cmd] ?? cmd;
export const OUT_CMDS = ["OUT_TOG", "OUT_USB", "OUT_BLE"];

// ---------- ids ----------

export function makeId(prefix: string, name: string, taken: Set<string>): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "item";
  let id = `ry_${prefix}_${slug}`;
  for (let n = 2; taken.has(id); n++) id = `ry_${prefix}_${slug}_${n}`;
  return id;
}

export const allIds = (d: BehaviorDoc) => new Set([...d.combos, ...d.macros, ...d.tapDances].map((x) => x.id));

// ---------- text → key taps ----------

const SHIFTED: Record<string, string> = {
  "!": "EXCL", "@": "AT", "#": "HASH", $: "DLLR", "%": "PRCNT", "^": "CARET", "&": "AMPS", "*": "STAR", "(": "LPAR", ")": "RPAR",
  _: "UNDER", "+": "PLUS", "{": "LBRC", "}": "RBRC", "|": "PIPE", ":": "COLON", '"': "DQT", "<": "LT", ">": "GT", "?": "QMARK", "~": "TILDE",
};
const PLAIN: Record<string, string> = {
  " ": "SPACE", "\n": "RET", "\t": "TAB", "-": "MINUS", "=": "EQUAL", "[": "LBKT", "]": "RBKT", "\\": "BSLH", ";": "SEMI", "'": "SQT", "`": "GRAVE",
  ",": "COMMA", ".": "DOT", "/": "FSLH",
};

/** Turns typed text into ZMK key names, or reports the characters that can't be typed (e.g. Hangul). */
export function textToKeys(text: string): { keys: string[]; bad: string[] } {
  const keys: string[] = [];
  const bad = new Set<string>();
  for (const ch of text) {
    if (/[a-z]/.test(ch)) keys.push(ch.toUpperCase());
    else if (/[A-Z]/.test(ch)) keys.push(`LS(${ch})`);
    else if (/[0-9]/.test(ch)) keys.push(`N${ch}`);
    else if (SHIFTED[ch]) keys.push(SHIFTED[ch]);
    else if (PLAIN[ch]) keys.push(PLAIN[ch]);
    else bad.add(ch);
  }
  return { keys, bad: [...bad] };
}

// ---------- devicetree output ----------

const wrapMods = (key: string, mods: Mod[] = []) => mods.reduceRight((acc, m) => `${m}(${acc})`, key);

export function bindingDt(b: Binding): string {
  switch (b.b) {
    case "kp":
    case "sk":
      return `&${b.b} ${wrapMods(b.key, b.mods)}`;
    case "mo":
    case "tog":
    case "to":
    case "sl":
      return `&${b.b} ${b.layer}`;
    case "bt":
      return `&bt ${b.cmd}`;
    case "out":
      return `&out ${b.cmd}`;
    case "ref":
      return `&${b.id}`;
    case "raw":
      return b.text.trim().startsWith("&") ? b.text.trim() : `&${b.text.trim()}`;
    default:
      return `&${b.b}`;
  }
}

// Names end up in the build's CMake cache too, where quotes, backslashes, semicolons and $ break the build.
export const cleanName = (s: string) => s.replace(/["\\;$`]/g, "").replace(/\s+/g, " ").trim() || "Untitled";
const dtString = (s: string) => `"${cleanName(s)}"`;

function macroBindings(m: Macro): string[] {
  const out: string[] = [];
  let mode: "tap" | "press" | "release" | null = null;
  let group: string[] = [];
  const flush = () => {
    if (group.length) out.push(`<&macro_${mode} ${group.join(" ")}>`);
    group = [];
  };
  const add = (want: "tap" | "press" | "release", dt: string) => {
    if (mode !== want) {
      flush();
      mode = want;
    }
    group.push(dt);
  };
  for (const s of m.steps) {
    if (s.t === "wait") {
      flush();
      mode = null;
      // A pause: stretch the gap after a do-nothing tap, then restore the macro's normal pacing.
      out.push(`<&macro_wait_time ${Math.max(0, Math.round(s.ms))}>`);
      out.push(`<&macro_tap &none>`);
      out.push(`<&macro_wait_time ${m.wait}>`);
    } else if (s.t === "text") {
      for (const k of textToKeys(s.text).keys) add("tap", `&kp ${k}`);
    } else {
      add(s.t, bindingDt(s.binding));
    }
  }
  flush();
  return out;
}

export function generateDtsi(d: BehaviorDoc, layerCount: number): string {
  const L: string[] = [];
  L.push("/*");
  L.push(" * Generated by keys.ryong.com — edit in the Behaviors editor, not by hand.");
  L.push(" * Source of truth: ryong-behaviors.json in this folder.");
  L.push(" */");
  L.push("");
  L.push("#include <dt-bindings/zmk/keys.h>");
  L.push("#include <dt-bindings/zmk/bt.h>");
  L.push("#include <dt-bindings/zmk/outputs.h>");
  L.push("");
  for (const st of d.settings ?? []) {
    const props = Object.entries(st.props).filter(([k]) => SETTING_SPECS[st.behavior]?.props[k]);
    if (!props.length) continue;
    L.push(`&${st.behavior} {`);
    for (const [k, v] of props) L.push(typeof v === "number" ? `    ${k} = <${Math.round(v)}>;` : `    ${k} = "${v.replace(/[^a-z-]/g, "")}";`);
    L.push("};");
    L.push("");
  }

  L.push("/ {");

  if (d.macros.length) {
    L.push("    macros {");
    for (const m of d.macros) {
      const b = macroBindings(m);
      L.push(`        ${m.id}: ${m.id} {`);
      L.push(`            compatible = "zmk,behavior-macro";`);
      L.push(`            #binding-cells = <0>;`);
      L.push(`            display-name = ${dtString(m.name)};`);
      L.push(`            wait-ms = <${m.wait}>;`);
      L.push(`            tap-ms = <${m.tap}>;`);
      L.push(`            bindings`);
      b.forEach((x, i) => L.push(`                ${i === 0 ? "=" : ","} ${x}`));
      L.push(`                ;`);
      L.push(`        };`);
    }
    L.push("    };");
    L.push("");
  }

  if (d.tapDances.length) {
    L.push("    behaviors {");
    for (const t of d.tapDances) {
      L.push(`        ${t.id}: ${t.id} {`);
      L.push(`            compatible = "zmk,behavior-tap-dance";`);
      L.push(`            #binding-cells = <0>;`);
      L.push(`            display-name = ${dtString(t.name)};`);
      L.push(`            tapping-term-ms = <${t.term}>;`);
      L.push(`            bindings = ${t.bindings.map((b) => `<${bindingDt(b)}>`).join(", ")};`);
      L.push(`        };`);
    }
    L.push("    };");
    L.push("");
  }

  if (d.combos.length) {
    L.push("    combos {");
    L.push(`        compatible = "zmk,combos";`);
    for (const c of d.combos) {
      L.push(`        ${c.id} {`);
      L.push(`            timeout-ms = <${c.timeout}>;`);
      L.push(`            key-positions = <${[...c.keys].sort((a, b) => a - b).join(" ")}>;`);
      L.push(`            bindings = <${bindingDt(c.binding)}>;`);
      const layers = c.layers.filter((l) => l < layerCount);
      if (layers.length) L.push(`            layers = <${[...layers].sort((a, b) => a - b).join(" ")}>;`);
      L.push(`        };`);
    }
    L.push("    };");
  }

  L.push("};");
  L.push("");
  return L.join("\n");
}

// ---------- checks ----------

export function problems(d: BehaviorDoc): string[] {
  const p: string[] = [];
  const ids = allIds(d);
  const refOk = (b: Binding, where: string) => {
    if (b.b === "ref" && !ids.has(b.id)) p.push(t("{w}: refers to something that was deleted", "{w}: 삭제된 항목을 쓰고 있어요", { w: where }));
    if (b.b === "kp" && !b.key) p.push(t("{w}: pick a key", "{w}: 키를 고르세요", { w: where }));
    if (b.b === "raw" && !b.text.trim()) p.push(t("{w}: custom binding is empty", "{w}: 직접 입력한 코드가 비어 있어요", { w: where }));
  };
  const seen = new Map<string, string>();
  for (const c of d.combos) {
    if (c.keys.length < 2) p.push(t("Combo “{n}”: choose at least 2 keys", "콤보 “{n}”: 키를 2개 이상 고르세요", { n: c.name }));
    const sig = [...c.keys].sort((a, b) => a - b).join(",") + "|" + [...c.layers].sort().join(",");
    if (seen.has(sig)) p.push(t("Combo “{n}” uses the same keys as “{o}”", "콤보 “{n}”의 키가 “{o}”와 같아요", { n: c.name, o: seen.get(sig)! }));
    seen.set(sig, c.name);
    refOk(c.binding, t("Combo “{n}”", "콤보 “{n}”", { n: c.name }));
  }
  for (const m of d.macros) {
    if (!m.steps.length) p.push(t("Macro “{n}”: add at least one step", "매크로 “{n}”: 단계를 하나 이상 추가하세요", { n: m.name }));
    m.steps.forEach((s, i) => {
      if (s.t === "text") {
        const { bad } = textToKeys(s.text);
        if (bad.length) p.push(t("Macro “{n}” step {i}: can't type {c}", "매크로 “{n}” {i}단계: {c}는 입력할 수 없어요", { n: m.name, i: i + 1, c: bad.map((c) => `“${c}”`).join(" ") }));
        if (!s.text) p.push(t("Macro “{n}” step {i}: text is empty", "매크로 “{n}” {i}단계: 입력할 글자가 비어 있어요", { n: m.name, i: i + 1 }));
      } else if (s.t !== "wait") {
        refOk(s.binding, t("Macro “{n}” step {i}", "매크로 “{n}” {i}단계", { n: m.name, i: i + 1 }));
        if (s.binding.b === "ref" && s.binding.id === m.id) p.push(t("Macro “{n}” can't run itself", "매크로 “{n}” 안에서 자기 자신을 실행할 수 없어요", { n: m.name }));
      }
    });
  }
  for (const td of d.tapDances) {
    if (td.bindings.length < 2) p.push(t("Tap dance “{n}”: needs at least 2 taps", "탭댄스 “{n}”: 탭이 2개 이상 필요해요", { n: td.name }));
    td.bindings.forEach((b, i) => {
      refOk(b, t("Tap dance “{n}” tap {i}", "탭댄스 “{n}” {i}번째 탭", { n: td.name, i: i + 1 }));
      if (b.b === "ref" && b.id === td.id) p.push(t("Tap dance “{n}” can't use itself", "탭댄스 “{n}” 안에서 자기 자신을 쓸 수 없어요", { n: td.name }));
    });
  }
  return p;
}

// ---------- labels ----------

export function bindingLabel(b: Binding, d?: BehaviorDoc, layerNames: string[] = []): string {
  const layer = (n: number) => layerNames[n] ?? t("Layer {n}", "레이어 {n}", { n });
  switch (b.b) {
    case "kp":
      return [...(b.mods ?? []).map((m) => MOD_LABEL[m]), b.key || "?"].join(" + ");
    case "sk":
      return `Sticky Key ${[...(b.mods ?? []).map((m) => MOD_LABEL[m]), b.key].join(" + ")}`;
    case "mo":
      return `Momentary Layer ${layer(b.layer)}`;
    case "tog":
      return `Toggle Layer ${layer(b.layer)}`;
    case "to":
      return `To Layer ${layer(b.layer)}`;
    case "sl":
      return `Sticky Layer ${layer(b.layer)}`;
    case "bt":
      return btLabel(b.cmd);
    case "out":
      return outLabel(b.cmd);
    case "ref": {
      const all = d ? [...d.macros, ...d.tapDances] : [];
      return all.find((x) => x.id === b.id)?.name ?? t("Missing", "없음");
    }
    case "raw":
      return b.text;
    case "trans":
      return "Transparent";
    case "none":
      return "None";
    case "caps_word":
      return "Caps Word";
    case "key_repeat":
      return "Key Repeat";
    case "studio_unlock":
      return "Studio Unlock";
    case "bootloader":
      return "Bootloader";
    case "sys_reset":
      return "Reset";
  }
}
