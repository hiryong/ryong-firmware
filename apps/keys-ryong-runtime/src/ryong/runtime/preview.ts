/** Explicit browser-only preview. Never talks to USB, BLE or GitHub. */
import * as C from "./proto/runtime_combo";
import * as M from "./proto/runtime_macro";
import { RuntimeSession, RuntimePort } from "./device";
import type { RuntimeView } from "./modelBridge";
import codes from "./keycode-values.json";

type Data = { combos: C.Combo[]; macros: M.MacroDetail[] };
const key = "ryong-runtime-preview-v1";
const clone = <T,>(value: T): T => structuredClone(value);
let cached: RuntimeView | null = null;

export async function makePreviewView(): Promise<RuntimeView> {
  if (cached) return { ...cached, snapshot: await cached.session.read() };
  const initial: Data = {
    combos: [C.Combo.fromPartial({ index: 0, name: "J + K → Esc", enabled: true,
      keyPositions: [35, 36], timeoutMs: 50, behavior: { behaviorId: 1, param1: codes.ESC } })],
    macros: [],
  };
  const stored = localStorage.getItem(key);
  let flash: Data = stored ? JSON.parse(stored) : initial;
  let ram = clone(flash);
  const cStatus = () => C.Response.fromPartial({ status: { affectedCount: 1 } });
  const mStatus = () => M.Response.fromPartial({ status: { affectedCount: 1 } });
  const persist = () => localStorage.setItem(key, JSON.stringify(flash));
  const port: RuntimePort = {
    physicalKeyCount: 61,
    assertUnlocked: async () => {},
    combo: async request => {
      if (request.listCombos) return C.Response.fromPartial({ listCombos: { combos: clone(ram.combos) } });
      if (request.getGlobalSettings) return C.Response.fromPartial({ getGlobalSettings: { settings: { maxCombo: 8, timeoutMs: 50 } } });
      if (request.setCombo) {
        const value = request.setCombo;
        const prior = ram.combos.find(combo => combo.index === value.index);
        ram.combos = ram.combos.filter(combo => combo.index !== value.index);
        ram.combos.push(C.Combo.fromPartial({ index: value.index, name: prior?.name ?? "", keyPositions: value.keyPositions,
          behavior: value.behavior, layerMask: value.layerMask, enabled: value.enabled, timeoutMs: value.timeoutMs,
          requirePriorIdleMs: value.requirePriorIdleMs, slowReleaseOverride: value.slowReleaseOverride }));
      } else if (request.setComboName) {
        const combo = ram.combos.find(item => item.index === request.setComboName!.index);
        if (combo) combo.name = request.setComboName.name;
      } else if (request.deleteCombo) {
        const combo = ram.combos.find(item => item.index === request.deleteCombo!.index);
        if (combo) combo.enabled = false;
      } else if (request.save) { flash.combos = clone(ram.combos); persist(); }
      else if (request.discard) ram.combos = clone(flash.combos);
      return cStatus();
    },
    macro: async request => {
      if (request.listMacros) return M.Response.fromPartial({ listMacros: {
        macros: ram.macros.map(macro => ({ slot: macro.slot, name: macro.name, encodedSize: macro.encodedSize })),
        maxMacroBytes: 256, maxNameLength: 24,
      } });
      if (request.getMacroGlobalSettings) return M.Response.fromPartial({ getMacroGlobalSettings: { settings: {
        tapMs: 30, maxEntries: 8, keyPressBehaviorId: 1, poolBytesTotal: 1024,
      } } });
      if (request.getMacro) return M.Response.fromPartial({ getMacro: {
        macro: clone(ram.macros.find(macro => macro.slot === request.getMacro!.slot)),
      } });
      if (request.createMacro) {
        let slot = 0; while (ram.macros.some(macro => macro.slot === slot)) slot++;
        ram.macros.push(M.MacroDetail.fromPartial({ slot, name: request.createMacro.name }));
      } else if (request.setMacroStepCount) {
        const macro = ram.macros.find(item => item.slot === request.setMacroStepCount!.slot);
        if (!macro) throw new Error("Preview macro is missing.");
        macro.steps.length = request.setMacroStepCount.stepCount;
      } else if (request.appendMacroStep) {
        const macro = ram.macros.find(item => item.slot === request.appendMacroStep!.slot);
        if (!macro || !request.appendMacroStep.step) throw new Error("Preview macro step is missing.");
        macro.steps.push(clone(request.appendMacroStep.step));
      } else if (request.saveMacros) { flash.macros = clone(ram.macros); persist(); }
      else if (request.discardMacros) ram.macros = clone(flash.macros);
      return mStatus();
    },
  };
  const session = new RuntimeSession(port);
  cached = { session, snapshot: await session.read(), catalog: {
    kp: 1, ref: 2, mo: 3, tog: 4, to: 5, sl: 6, sk: 7,
    none: 8, trans: 9, caps_word: 10, key_repeat: 11, studio_unlock: 12,
  }, layerNames: ["Base", "Fn", "Mac"] };
  return cached;
}
