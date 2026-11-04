import { call_rpc } from "../../rpc/pipeline";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import type { BehaviorDoc, Binding, Mod, MacroStep as EditorStep } from "../behaviors/model";
import { emptyDoc, textToKeys, BT_CMDS, OUT_CMDS, FLAVORS } from "../behaviors/model";
import values from "./keycode-values.json";
import * as C from "./proto/runtime_combo";
import * as M from "./proto/runtime_macro";
import { connectRuntime, DesiredCombo, DesiredProfile, RuntimeSession, RuntimeSnapshot } from "./device";

// The generated table misses the bracket keys; add them (HID 0x2F / 0x30) so "[" "]" can be stored.
const codes = { ...(values as Record<string, number>), LBKT: 0x7002f, LEFT_BRACKET: 0x7002f, RBKT: 0x70030, RIGHT_BRACKET: 0x70030 } as Record<string, number>;
// ZMK's shifted aliases (what typed text like "!" or "?" turns into) are just Shift + the base key.
const SHIFTED_ALIASES: Record<string, string> = {
  EXCL: "N1", EXCLAMATION: "N1", AT: "N2", AT_SIGN: "N2", HASH: "N3", POUND: "N3", DLLR: "N4", DOLLAR: "N4", PRCNT: "N5", PERCENT: "N5",
  CARET: "N6", AMPS: "N7", AMPERSAND: "N7", STAR: "N8", ASTRK: "N8", ASTERISK: "N8", LPAR: "N9", LEFT_PARENTHESIS: "N9", RPAR: "N0", RIGHT_PARENTHESIS: "N0",
  UNDER: "MINUS", UNDERSCORE: "MINUS", PLUS: "EQUAL", LBRC: "LBKT", LEFT_BRACE: "LBKT", RBRC: "RBKT", RIGHT_BRACE: "RBKT", PIPE: "BSLH",
  COLON: "SEMI", DQT: "SQT", DOUBLE_QUOTES: "SQT", LT: "COMMA", LESS_THAN: "COMMA", GT: "DOT", GREATER_THAN: "DOT", QMARK: "FSLH", QUESTION: "FSLH", TILDE: "GRAVE",
};
const mods: Mod[] = ["LC", "LS", "LA", "LG", "RC", "RS", "RA", "RG"];
const aliases: Record<string, string[]> = {
  kp: ["keypress"], sk: ["stickykey"], mo: ["momentarylayer"],
  tog: ["togglelayer"], to: ["tolayer"], sl: ["stickylayer"],
  none: ["none"], trans: ["transparent"], caps_word: ["capsword"],
  key_repeat: ["keyrepeat"], studio_unlock: ["studiounlock"],
  mt: ["modtap"], lt: ["layertap"], osmt: ["osmodtap"], rtd: ["runtimetapdance"],
  ref: ["runtimemacro"], bt: ["bluetooth"], out: ["outputselection"],
  sys_reset: ["reset"], bootloader: ["bootloader"],
};
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export type Catalog = Record<string, number>;
export type RuntimeView = {
  session: RuntimeSession; snapshot: RuntimeSnapshot; catalog: Catalog; layerNames: string[];
  /** Behavior display names. A runtime macro whose name is one of these is played by a key bound by name. */
  behaviorNames?: string[];
};

export async function loadRuntimeView(conn: RpcConnection): Promise<RuntimeView> {
  const session = await connectRuntime(conn);
  const snapshot = await session.read();
  const list = (await call_rpc(conn, { behaviors: { listAllBehaviors: true } })).behaviors?.listAllBehaviors?.behaviors;
  if (!list) throw new Error("Device behavior catalog is missing.");
  const catalog: Catalog = {};
  const behaviorNames: string[] = [];
  const details = await Promise.all(list.map((id) => call_rpc(conn, { behaviors: { getBehaviorDetails: { behaviorId: id } } })));
  for (const [i, id] of list.entries()) {
    const detail = details[i].behaviors?.getBehaviorDetails;
    if (!detail) throw new Error("Incomplete device behavior catalog.");
    behaviorNames.push(detail.displayName);
    const name = normalized(detail.displayName);
    for (const [kind, names] of Object.entries(aliases)) {
      if (names.includes(name)) {
        if (catalog[kind] !== undefined && catalog[kind] !== id) throw new Error("Ambiguous device behavior: " + kind);
        catalog[kind] = id;
      }
    }
  }
  if (!catalog.kp || !catalog.ref) throw new Error("Key Press / Runtime Macro behavior is unavailable.");
  session.port.runtimeMacroBehaviorId = catalog.ref;
  session.port.runtimeDanceBehaviorId = catalog.rtd;
  session.port.noneBehaviorId = catalog.none;
  const keymap = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap?.getKeymap;
  if (!keymap) throw new Error("Device keymap is unavailable.");
  return { session, snapshot, catalog, layerNames: keymap.layers.map(layer => layer.name), behaviorNames };
}

export function keyValue(key: string, depth = 0): number {
  if (depth > 8) throw new Error("Modifier nesting exceeds limits.");
  if (Object.prototype.hasOwnProperty.call(codes, key) && !key.startsWith("__")) return codes[key];
  const match = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/.exec(key);
  if (match) return (keyValue(match[2], depth + 1) | codes["__mod_" + match[1]]) >>> 0;
  if (Object.prototype.hasOwnProperty.call(SHIFTED_ALIASES, key)) return keyValue(`LS(${SHIFTED_ALIASES[key]})`, depth + 1);
  throw new Error("Unsupported key: " + key);
}

function keyBinding(usage: number): Binding {
  const exact = Object.entries(codes).find(([name, value]) => !name.startsWith("__") && value === usage);
  if (exact) return { b: "kp", key: exact[0], mods: [] };
  const selected = mods.filter(mod => (usage & codes["__mod_" + mod]) !== 0);
  const mask = mods.reduce((acc, mod) => acc | codes["__mod_" + mod], 0);
  const plain = (usage & ~mask) >>> 0;
  const key = Object.entries(codes).find(([name, value]) => !name.startsWith("__") && value === plain);
  if (!key) throw new Error("Device keycode cannot be represented by this editor: " + usage);
  return { b: "kp", key: key[0], mods: selected };
}

export function decode(binding: C.BehaviorBinding | undefined, view: RuntimeView): Binding {
  if (!binding) throw new Error("Missing device binding.");
  const kind = Object.entries(view.catalog).find(([, id]) => id === binding.behaviorId)?.[0];
  if (kind === "kp" || kind === "sk") return { ...keyBinding(binding.param1), b: kind } as Binding;
  if (kind === "bt" || kind === "out") {
    const prefix = kind === "bt" ? "__bt_" : "__out_";
    const command = Object.entries(codes).find(([name, value]) => name.startsWith(prefix) && value === binding.param1)?.[0].slice(prefix.length);
    if (!command) throw new Error("Unknown device output/Bluetooth command.");
    return { b: kind, cmd: command + (command === "BT_SEL" || command === "BT_DISC" ? " " + binding.param2 : "") } as Binding;
  }
  if (kind === "rtd") return {b:"ref",id:"runtime_dance_"+binding.param1};
  if (kind === "ref") return { b: "ref", id: "runtime_macro_" + binding.param1 };
  if (["mo", "tog", "to", "sl"].includes(kind ?? "")) return { b: kind, layer: binding.param1 } as Binding;
  if (["none", "trans", "caps_word", "key_repeat", "studio_unlock", "sys_reset", "bootloader"].includes(kind ?? "")) return { b: kind } as Binding;
  throw new Error("A device behavior is not yet supported by the runtime editor: " + binding.behaviorId);
}

/** A binding as the keyboard stores it (for putting it on a key). */
export function wireOf(binding: Binding, view: RuntimeView, doc: BehaviorDoc): C.BehaviorBinding { return encode(binding, view, doc).wire; }

function encode(binding: Binding, view: RuntimeView, doc: BehaviorDoc): { wire: C.BehaviorBinding; macroName?: string; danceName?: string } {
  const behaviorId = binding.b === "ref" && doc.tapDances.some(d=>d.id===binding.id) ? view.catalog.rtd : view.catalog[binding.b];
  if (!behaviorId) throw new Error("Runtime behavior is not supported: " + binding.b);
  if (binding.b === "kp" || binding.b === "sk") {
    if ((binding.mods ?? []).some(mod => !mods.includes(mod))) throw new Error("Unknown modifier.");
    const param1 = (binding.mods ?? []).reduce((usage, mod) => usage | codes["__mod_" + mod], keyValue(binding.key)) >>> 0;
    return { wire: { behaviorId, param1, param2: 0 } };
  }
  if (binding.b === "bt" || binding.b === "out") {
    const allowed = binding.b === "bt" ? BT_CMDS : [...OUT_CMDS, "OUT_NONE"];
    if (!allowed.includes(binding.cmd)) throw new Error("Unsupported Bluetooth/output command.");
    const [command, argument] = binding.cmd.split(" ");
    const param1 = codes[(binding.b === "bt" ? "__bt_" : "__out_") + command];
    if (param1 === undefined) throw new Error("Unknown firmware command.");
    return { wire: { behaviorId, param1, param2: argument === undefined ? 0 : Number(argument) } };
  }
  if (binding.b === "ref") {
    const macro = doc.macros.find(item => item.id === binding.id);
    if (!macro) {
      const dance=doc.tapDances.find(d=>d.id===binding.id);
      if(!dance)throw new Error("Behavior reference is missing.");
      const index=view.snapshot.advanced?.dances.find(d=>"runtime_dance_"+d.index===dance.id)?.index ?? 0;
      return {wire:{behaviorId,param1:index,param2:0},danceName:dance.name};
    }
    const slot = view.snapshot.macros.find(item => "runtime_macro_" + item.slot === macro.id)?.slot ?? 0;
    return { wire: { behaviorId, param1: slot, param2: 0 }, macroName: macro.name };
  }
  if (binding.b === "mo" || binding.b === "tog" || binding.b === "to" || binding.b === "sl") {
    if (!Number.isInteger(binding.layer) || binding.layer < 0 || binding.layer >= view.layerNames.length) throw new Error("Unknown layer.");
    return { wire: { behaviorId, param1: binding.layer, param2: 0 } };
  }
  return { wire: { behaviorId, param1: 0, param2: 0 } };
}

export function viewDocument(view: RuntimeView): BehaviorDoc {
  const doc = emptyDoc();
  doc.macros = view.snapshot.macros.map(macro => ({
    id: "runtime_macro_" + macro.slot, name: macro.name, tap: view.snapshot.macroLimits.tapMs, wait: 0,
    steps: macro.steps.flatMap<EditorStep>(step => {
      if (step.delay) return [{ t: "wait" as const, ms: step.delay.delayMs }];
      if (step.keyTapSequence) {
        return Array.from(step.keyTapSequence.packedKeys, packed => ({
          t: "tap" as const, binding: (() => {
            if ((packed & 0x7f) < 4 || (packed & 0x7f) > 0x38) throw new Error("Invalid packed macro key.");
            return keyBinding((0x70000 | (packed & 0x7f) | ((packed & 0x80) ? codes.__mod_LS : 0)) >>> 0);
          })(),
        }));
      }
      if (step.down) return [{ t: "press" as const, binding: decode(step.down, view) }];
      if (step.up) return [{ t: "release" as const, binding: decode(step.up, view) }];
      if (step.tap) return [{ t: "tap" as const, binding: decode(step.tap, view) }];
      throw new Error("Unknown macro step.");
    }),
  }));
  doc.combos = view.snapshot.combos.filter(combo => combo.enabled).map(combo => ({
    id: "runtime_combo_" + combo.index, name: combo.name || "Combo " + (combo.index + 1),
    keys: [...combo.keyPositions], layers: Array.from({ length: view.layerNames.length }, (_, layer) => layer).filter(layer => combo.layerMask && (combo.layerMask & (1 << layer)) !== 0),
    timeout: combo.timeoutMs || view.snapshot.comboLimits.timeoutMs, binding: decode(combo.behavior, view),
  }));
  if (view.snapshot.advanced) {
    const a = view.snapshot.advanced;
    doc.tapDances = a.dances.map(d=>({id:"runtime_dance_"+d.index,name:d.name,term:a.global.intervalMs,
      bindings:[d.config?.singleBinding,d.config?.doubleBinding,d.config?.tripleBinding].filter(b=>b?.behaviorId).map(b=>decode(b,view))}));
    doc.settings = a.holds.map(h=>({behavior:Object.entries(view.catalog).find(([kind,id])=>(kind==="mt"||kind==="lt")&&id===h.behaviorId)?.[0] ?? "holdtap_"+h.slot,
      props:{"tapping-term-ms":h.tappingTermMs,"quick-tap-ms":h.quickTapMs,"require-prior-idle-ms":h.requirePriorIdleMs,flavor:FLAVORS[h.flavor]}}));
  }
  return doc;
}

export function compileDocument(doc: BehaviorDoc, view: RuntimeView): DesiredProfile {
  if ((doc.tapDances.length || doc.settings.length) && !view.snapshot.advanced) throw new Error("Advanced runtime module is unavailable; nothing was written.");
  const original = viewDocument(view);
  const macros = doc.macros.map(macro => {
    if (![macro.tap, macro.wait].every(value => Number.isInteger(value) && value >= 0 && value <= 5000)) throw new Error("Invalid macro timing.");
    const old = view.snapshot.macros.find(item => "runtime_macro_" + item.slot === macro.id);
    if (old && JSON.stringify(original.macros.find(item => item.id === macro.id)) === JSON.stringify(macro)) {
      return { slot: old.slot, name: macro.name, steps: old.steps };
    }
    const steps: M.MacroStep[] = [];
    const wait = (ms: number) => { if (ms) steps.push(M.MacroStep.fromPartial({ delay: { delayMs: ms } })); };
    const bindingStep = (kind: "tap" | "press" | "release", binding: Binding) => {
      if (binding.b === "ref") throw new Error("Nested runtime macros are not enabled.");
      const wire = encode(binding, view, doc).wire;
      if (kind === "tap") {
        if (macro.tap === view.snapshot.macroLimits.tapMs) steps.push(M.MacroStep.fromPartial({ tap: wire }));
        else {
          steps.push(M.MacroStep.fromPartial({ down: wire })); wait(macro.tap);
          steps.push(M.MacroStep.fromPartial({ up: wire }));
        }
      } else steps.push(M.MacroStep.fromPartial(kind === "press" ? { down: wire } : { up: wire }));
      wait(macro.wait);
    };
    for (const step of macro.steps) {
      if (!["wait","text","tap","press","release"].includes(step.t)) throw new Error("Unknown macro step type.");
      if (step.t === "wait") wait(step.ms);
      else if (step.t === "text") {
        const text = textToKeys(step.text);
        if (text.bad.length) throw new Error("Text contains unsupported characters: " + text.bad.join(""));
        text.keys.forEach(key => bindingStep("tap", { b: "kp", key }));
      } else bindingStep(step.t, step.binding);
    }
    return { slot: old?.slot, name: macro.name, steps };
  });
  const used = new Set<number>();
  const combos: DesiredCombo[] = doc.combos.map(combo => {
    if (combo.layers.some(layer => !Number.isInteger(layer) || layer < 0 || layer >= Math.min(32, view.layerNames.length))) throw new Error("Unknown combo layer.");
    const old = view.snapshot.combos.find(item => "runtime_combo_" + item.index === combo.id);
    let index = old?.index ?? 0;
    if (!old) {
      while (used.has(index) || doc.combos.some(other => other !== combo && other.id === "runtime_combo_" + index)) index++;
    }
    if (used.has(index)) throw new Error("Duplicate combo slot.");
    used.add(index);
    const binding = encode(combo.binding, view, doc);
    return { ...C.Combo.fromPartial({
      ...old, index, name: combo.name, enabled: true, keyPositions: combo.keys,
      behavior: binding.wire, layerMask: combo.layers.reduce((mask, layer) => (mask | (1 << layer)) >>> 0, 0),
      timeoutMs: combo.timeout,
    }), macroName: binding.macroName, danceName:binding.danceName };
  });
  const advanced = view.snapshot.advanced ? (() => {
    const old = view.snapshot.advanced!;
    const intervals = new Set(doc.tapDances.map(d=>d.term));
    if (intervals.size > 1) throw new Error("This firmware uses one global Tap Dance interval. Set the same interval on all cards.");
    const dances = doc.tapDances.map(d=>({index:old.dances.find(x=>"runtime_dance_"+x.index===d.id)?.index,name:d.name,
      bindings:d.bindings.map(b=>{ const result=encode(b,view,doc); if(result.danceName)throw new Error("Nested Tap Dance is not supported."); return {...result.wire,...(result.macroName?{macroName:result.macroName}:{})}; })}));
    const holds = old.holds.map(h=>{
      const behavior = Object.entries(view.catalog).find(([kind,id])=>(kind==="mt"||kind==="lt")&&id===h.behaviorId)?.[0] ?? "holdtap_"+h.slot;
      const props = doc.settings.find(s=>s.behavior===behavior)?.props;
      if (!props) return h;
      return {...h,tappingTermMs:Number(props["tapping-term-ms"] ?? h.tappingTermMs),quickTapMs:Number(props["quick-tap-ms"] ?? h.quickTapMs),
        requirePriorIdleMs:Number(props["require-prior-idle-ms"] ?? h.requirePriorIdleMs),flavor:props.flavor === undefined ? h.flavor : FLAVORS.indexOf(String(props.flavor))};
    });
    const allowed = old.holds.map(h=>Object.entries(view.catalog).find(([kind,id])=>(kind==="mt"||kind==="lt")&&id===h.behaviorId)?.[0] ?? "holdtap_"+h.slot);
    if (doc.settings.some(s=>!allowed.includes(s.behavior))) throw new Error("Only discovered runtime Hold-Tap options are supported.");
    return {dances,holds,interval:doc.tapDances[0]?.term ?? old.global.intervalMs};
  })() : undefined;
  const desired = { combos, macros, advanced };
  view.session.validate(view.snapshot, desired);
  return desired;
}

