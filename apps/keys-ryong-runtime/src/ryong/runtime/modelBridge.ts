import { call_rpc } from "@zmkfirmware/zmk-studio-ts-client/index";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import type { BehaviorDoc, Binding, Mod } from "../behaviors/model";
import { emptyDoc, textToKeys } from "../behaviors/model";
import values from "./keycode-values.json";
import * as C from "./proto/runtime_combo";
import * as M from "./proto/runtime_macro";
import { connectRuntime, DesiredCombo, DesiredProfile, RuntimeSession, RuntimeSnapshot } from "./device";

const codes = values as Record<string, number>;
const mods: Mod[] = ["LC", "LS", "LA", "LG", "RC", "RS", "RA", "RG"];
const aliases: Record<string, string[]> = {
  kp: ["keypress"], sk: ["stickykey"], mo: ["momentarylayer"],
  tog: ["togglelayer"], to: ["tolayer"], sl: ["stickylayer"],
  none: ["none"], trans: ["transparent"], caps_word: ["capsword"],
  key_repeat: ["keyrepeat"], studio_unlock: ["studiounlock"],
  ref: ["runtimemacro"],
};
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export type Catalog = Record<string, number>;
export type RuntimeView = {
  session: RuntimeSession; snapshot: RuntimeSnapshot; catalog: Catalog; layerNames: string[];
};

export async function loadRuntimeView(conn: RpcConnection): Promise<RuntimeView> {
  const session = await connectRuntime(conn);
  const snapshot = await session.read();
  const list = (await call_rpc(conn, { behaviors: { listAllBehaviors: true } })).behaviors?.listAllBehaviors?.behaviors;
  if (!list) throw new Error("Device behavior catalog is missing.");
  const catalog: Catalog = {};
  for (const id of list) {
    const detail = (await call_rpc(conn, { behaviors: { getBehaviorDetails: { behaviorId: id } } })).behaviors?.getBehaviorDetails;
    if (!detail) throw new Error("Incomplete device behavior catalog.");
    const name = normalized(detail.displayName);
    for (const [kind, names] of Object.entries(aliases)) {
      if (names.includes(name)) {
        if (catalog[kind] !== undefined && catalog[kind] !== id) throw new Error("Ambiguous device behavior: " + kind);
        catalog[kind] = id;
      }
    }
  }
  if (!catalog.kp || !catalog.ref) throw new Error("Key Press / Runtime Macro behavior is unavailable.");
  const keymap = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap?.getKeymap;
  if (!keymap) throw new Error("Device keymap is unavailable.");
  return { session, snapshot, catalog, layerNames: keymap.layers.map(layer => layer.name) };
}

export function keyValue(key: string, depth = 0): number {
  if (depth > 8) throw new Error("Modifier nesting exceeds limits.");
  if (Object.hasOwn(codes, key) && !key.startsWith("__")) return codes[key];
  const match = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/.exec(key);
  if (match) return (keyValue(match[2], depth + 1) | codes["__mod_" + match[1]]) >>> 0;
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

function decode(binding: C.BehaviorBinding | undefined, view: RuntimeView): Binding {
  if (!binding) throw new Error("Missing device binding.");
  const kind = Object.entries(view.catalog).find(([, id]) => id === binding.behaviorId)?.[0];
  if (kind === "kp" || kind === "sk") return { ...keyBinding(binding.param1), b: kind } as Binding;
  if (kind === "ref") return { b: "ref", id: "runtime_macro_" + binding.param1 };
  if (["mo", "tog", "to", "sl"].includes(kind ?? "")) return { b: kind, layer: binding.param1 } as Binding;
  if (["none", "trans", "caps_word", "key_repeat", "studio_unlock"].includes(kind ?? "")) return { b: kind } as Binding;
  throw new Error("A device behavior is not yet supported by the runtime editor: " + binding.behaviorId);
}

function encode(binding: Binding, view: RuntimeView, doc: BehaviorDoc): { wire: C.BehaviorBinding; macroName?: string } {
  const behaviorId = view.catalog[binding.b];
  if (!behaviorId) throw new Error("Runtime behavior is not supported: " + binding.b);
  if (binding.b === "kp" || binding.b === "sk") {
    const param1 = (binding.mods ?? []).reduce((usage, mod) => usage | codes["__mod_" + mod], keyValue(binding.key)) >>> 0;
    return { wire: { behaviorId, param1, param2: 0 } };
  }
  if (binding.b === "ref") {
    const macro = doc.macros.find(item => item.id === binding.id);
    if (!macro) throw new Error("Macro reference is missing.");
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
    steps: macro.steps.flatMap(step => {
      if (step.delay) return [{ t: "wait" as const, ms: step.delay.delayMs }];
      if (step.keyTapSequence) {
        return Array.from(step.keyTapSequence.packedKeys, packed => ({
          t: "tap" as const, binding: keyBinding((0x70000 | (packed & 0x7f) | ((packed & 0x80) ? codes.__mod_LS : 0)) >>> 0),
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
  return doc;
}

export function compileDocument(doc: BehaviorDoc, view: RuntimeView): DesiredProfile {
  if (doc.tapDances.length || doc.settings.length) throw new Error("Tap Dance / behavior options are not runtime-enabled yet; nothing was written.");
  const original = viewDocument(view);
  const macros = doc.macros.map(macro => {
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
    }), macroName: binding.macroName };
  });
  const desired = { combos, macros };
  view.session.validate(view.snapshot, desired);
  return desired;
}
