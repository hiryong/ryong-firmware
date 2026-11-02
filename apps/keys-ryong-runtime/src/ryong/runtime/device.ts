import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "@zmkfirmware/zmk-studio-ts-client/index";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import * as C from "./proto/runtime_combo";
import * as M from "./proto/runtime_macro";
import { callRuntimePayload, discoverRuntime } from "./customRpc";

export type RuntimeSnapshot = {
  combos: C.Combo[];
  macros: M.MacroDetail[];
  comboLimits: C.GlobalSettings;
  macroLimits: M.MacroGlobalSettings;
  maxMacroBytes: number;
  maxNameLength: number;
};
export type DesiredMacro = { slot?: number; name: string; steps: M.MacroStep[] };
export type DesiredCombo = C.Combo & { macroName?: string };
export type DesiredProfile = { combos: DesiredCombo[]; macros: DesiredMacro[] };
export type RuntimePort = {
  physicalKeyCount: number;
  combo: (request: C.Request) => Promise<C.Response>;
  macro: (request: M.Request) => Promise<M.Response>;
  assertUnlocked: () => Promise<void>;
};
export type RecoveryJournal = {
  prepare: (before: RuntimeSnapshot, desired: DesiredProfile) => void;
  complete: () => void;
};
const occupied = new WeakSet<object>();
const canonical = (value: unknown) => JSON.stringify(value);

function check(response: { error?: { message: string } }) {
  if (response.error) throw new Error(response.error.message);
}

/** Injectable only for protocol/fault tests; UI uses connectRuntime. */
export class RuntimeSession {
  constructor(readonly port: RuntimePort) {}

  async read(): Promise<RuntimeSnapshot> {
    await this.port.assertUnlocked();
    const combos = await this.port.combo(C.Request.fromPartial({ listCombos: {} }));
    const comboLimits = await this.port.combo(C.Request.fromPartial({ getGlobalSettings: {} }));
    const macros = await this.port.macro(M.Request.fromPartial({ listMacros: {} }));
    const macroLimits = await this.port.macro(M.Request.fromPartial({ getMacroGlobalSettings: {} }));
    for (const response of [combos, comboLimits, macros, macroLimits]) check(response);
    if (!combos.listCombos || !comboLimits.getGlobalSettings?.settings ||
        !macros.listMacros || !macroLimits.getMacroGlobalSettings?.settings) {
      throw new Error("Incomplete runtime capability response.");
    }
    const details: M.MacroDetail[] = [];
    for (const summary of macros.listMacros.macros) {
      const response = await this.port.macro(M.Request.fromPartial({ getMacro: { slot: summary.slot } }));
      check(response);
      if (!response.getMacro?.macro || response.getMacro.macro.slot !== summary.slot) {
        throw new Error("Macro slot changed while reading. Reload the device.");
      }
      details.push(response.getMacro.macro);
    }
    return {
      combos: combos.listCombos.combos,
      macros: details,
      comboLimits: comboLimits.getGlobalSettings.settings,
      macroLimits: macroLimits.getMacroGlobalSettings.settings,
      maxMacroBytes: macros.listMacros.maxMacroBytes,
      maxNameLength: macros.listMacros.maxNameLength,
    };
  }

  /** Stage in RAM, persist only after all requested writes have succeeded.
   * Recovery journal remains pending on EVERY failure, including lost ACK.
   * Flash persistence is per module/item, not a profile-wide atomic commit.
   */
  async save(before: RuntimeSnapshot, desired: DesiredProfile, journal: RecoveryJournal) {
    if (occupied.has(this.port)) throw new Error("Another runtime save is in progress.");
    occupied.add(this.port);
    let mutationStarted = false;
    try {
      await this.port.assertUnlocked();
      const current = await this.read();
      if (canonical(current) !== canonical(before)) throw new Error("Device changed. Reload before saving.");
      this.validate(before, desired);
      journal.prepare(before, desired); // must succeed before any device mutation
      mutationStarted = true;
      // Never reuse/delete a slot that a keymap may still reference.
      for (const old of before.macros) {
        const next = desired.macros.find(macro => macro.slot === old.slot);
        if (!next || next.name !== old.name) {
          throw new Error("Deleting or renaming an existing macro needs keymap-slot migration; it is not enabled yet.");
        }
      }
      for (const macro of desired.macros) {
        let slot = macro.slot;
        if (slot === undefined) {
          check(await this.port.macro(M.Request.fromPartial({ createMacro: { name: macro.name, persist: false } })));
          const listed = await this.port.macro(M.Request.fromPartial({ listMacros: {} }));
          check(listed);
          slot = listed.listMacros?.macros.find(item => item.name === macro.name)?.slot;
          if (slot === undefined) throw new Error("Created macro has no confirmed device slot.");
        }
        check(await this.port.macro(M.Request.fromPartial({ setMacroStepCount: { slot, stepCount: 0, persist: false } })));
        for (const step of macro.steps) {
          check(await this.port.macro(M.Request.fromPartial({ appendMacroStep: { slot, step, persist: false } })));
        }
        const verify = await this.port.macro(M.Request.fromPartial({ getMacro: { slot } }));
        check(verify);
        if (canonical(verify.getMacro?.macro?.steps) !== canonical(macro.steps)) {
          throw new Error("Macro readback differs from requested data.");
        }
      }
      const macroCatalog = await this.port.macro(M.Request.fromPartial({ listMacros: {} }));
      check(macroCatalog);
      const resolvedCombos = desired.combos.map(combo => {
        if (!combo.macroName) return combo;
        const macro = macroCatalog.listMacros?.macros.find(item => item.name === combo.macroName);
        if (!macro || !combo.behavior) throw new Error("Referenced macro has no confirmed slot.");
        return { ...combo, behavior: { ...combo.behavior, param1: macro.slot } };
      });
      for (const combo of resolvedCombos) {
        check(await this.port.combo(C.Request.fromPartial({ setCombo: {
          index: combo.index, keyPositions: combo.keyPositions, behavior: combo.behavior,
          layerMask: combo.layerMask, enabled: combo.enabled, timeoutMs: combo.timeoutMs,
          requirePriorIdleMs: combo.requirePriorIdleMs, slowReleaseOverride: combo.slowReleaseOverride,
          persist: false,
        } })));
        check(await this.port.combo(C.Request.fromPartial({ setComboName: {
          index: combo.index, name: combo.name, persist: false,
        } })));
      }
      for (const old of before.combos) {
        if (!desired.combos.some(combo => combo.index === old.index)) {
          check(await this.port.combo(C.Request.fromPartial({ deleteCombo: { index: old.index, persist: false } })));
        }
      }
      await this.port.assertUnlocked();
      check(await this.port.macro(M.Request.fromPartial({ saveMacros: {} })));
      check(await this.port.combo(C.Request.fromPartial({ save: {} })));
      const result = await this.read();
      // Keep journal if final readback fails or a device restarts between saves.
      for (const combo of resolvedCombos) {
        const actual = result.combos.find(item => item.index === combo.index);
        if (!actual || actual.enabled !== combo.enabled ||
            actual.timeoutMs !== combo.timeoutMs ||
            canonical(actual.keyPositions) !== canonical(combo.keyPositions) ||
            canonical(actual.behavior) !== canonical(combo.behavior) ||
            actual.layerMask !== combo.layerMask || actual.name !== combo.name) {
          throw new Error("Persisted combo readback differs. Recovery journal retained.");
        }
      }
      for (const macro of desired.macros) {
        const actual = result.macros.find(item => item.name === macro.name);
        if (!actual || canonical(actual.steps) !== canonical(macro.steps) ||
            (macro.slot !== undefined && actual.slot !== macro.slot)) {
          throw new Error("Persisted macro readback differs. Recovery journal retained.");
        }
      }
      journal.complete();
      return result;
    } catch (error) {
      // Do not retry saves or delete newly allocated slots after an unknown outcome.
      // If connected, discard the remaining RAM-only edits back to saved state.
      if (mutationStarted) {
        try {
          await this.port.macro(M.Request.fromPartial({ discardMacros: {} }));
          await this.port.combo(C.Request.fromPartial({ discard: {} }));
        } catch { /* connection may be gone; journal is still pending */ }
      }
      throw error;
    } finally {
      occupied.delete(this.port);
    }
  }

  validate(before: RuntimeSnapshot, desired: DesiredProfile) {
    if (desired.combos.length > before.comboLimits.maxCombo ||
        desired.macros.length > before.macroLimits.maxEntries) throw new Error("Device slot limit exceeded.");
    const names = new Set<string>();
    const slots = new Set<number>();
    for (const macro of desired.macros) {
      if (!macro.name || new TextEncoder().encode(macro.name).length > before.maxNameLength ||
          names.has(macro.name)) throw new Error("Invalid or duplicate macro name.");
      names.add(macro.name);
      if (macro.slot !== undefined) {
        if (!Number.isInteger(macro.slot) || macro.slot < 0 || macro.slot >= before.macroLimits.maxEntries ||
            slots.has(macro.slot) || !before.macros.some(old => old.slot === macro.slot && old.name === macro.name)) {
          throw new Error("Unconfirmed or duplicate macro slot.");
        }
        slots.add(macro.slot);
      } else if (before.macros.some(old => old.name === macro.name)) throw new Error("Macro name already exists.");
      // Conservative byte bound until the device's storage codec is exposed.
      if (macro.steps.length === 0 || macro.steps.length > 64 ||
          macro.steps.some(step => M.MacroStep.encode(step).finish().length > 80)) {
        throw new Error("Macro execution bound exceeded.");
      }
      const unchanged = before.macros.some(old => old.slot === macro.slot && canonical(old.steps) === canonical(macro.steps));
      if (!unchanged) {
        const held = new Set<string>();
        let duration = 0;
        for (const step of macro.steps) {
          const types = [step.down, step.up, step.tap, step.delay, step.keyTapSequence].filter(Boolean);
          if (types.length !== 1 || step.keyTapSequence) throw new Error("Unsupported or ambiguous macro step.");
          if (step.delay) {
            if (!Number.isInteger(step.delay.delayMs) || step.delay.delayMs < 0 || step.delay.delayMs > 5000) throw new Error("Invalid macro delay.");
            duration += step.delay.delayMs;
            if (duration > 10000) throw new Error("Macro duration limit exceeded.");
          } else {
            const binding = step.down || step.up || step.tap;
            if (!binding?.behaviorId) throw new Error("Macro behavior is missing.");
            const key = canonical(binding);
            if (step.down) {
              if (held.has(key)) throw new Error("Repeated macro press.");
              held.add(key);
            } else if (step.up) {
              if (!held.delete(key)) throw new Error("Macro release without matching press.");
            } else if (held.has(key)) throw new Error("Macro tap conflicts with held binding.");
          }
        }
        if (held.size) throw new Error("Macro has keys left pressed.");
      }
    }
    const comboSlots = new Set<number>();
    for (const combo of desired.combos) {
      if (!Number.isInteger(combo.index) || combo.index < 0 || combo.index >= before.comboLimits.maxCombo ||
          comboSlots.has(combo.index) || combo.keyPositions.length < 2 || combo.keyPositions.length > 4 ||
          new Set(combo.keyPositions).size !== combo.keyPositions.length ||
          combo.keyPositions.some(position => !Number.isInteger(position) || position < 0 || position >= this.port.physicalKeyCount) ||
          !combo.behavior || !combo.behavior.behaviorId ||
          !Number.isInteger(combo.timeoutMs) || combo.timeoutMs < 1 || combo.timeoutMs > 1000) {
        throw new Error("Invalid runtime combo.");
      }
      if (combo.macroName && !desired.macros.some(macro => macro.name === combo.macroName)) throw new Error("Unknown combo macro reference.");
      comboSlots.add(combo.index);
    }
    // Validate deletions/renames before staging anything.
    for (const old of before.macros) {
      if (!desired.macros.some(next => next.slot === old.slot && next.name === old.name)) {
        throw new Error("Macro deletion/rename requires keymap-slot migration.");
      }
    }
  }
}

export async function connectRuntime(conn: RpcConnection) {
  const subsystems = await discoverRuntime(conn);
  const find = (name: string) => {
    const entry = subsystems.find(item => item.identifier === name);
    if (!entry) throw new Error("Required runtime feature is missing: " + name);
    return entry.index;
  };
  const comboIndex = find("cormoran__runtime_combo");
  const macroIndex = find("cormoran__runtime_macro");
  const layouts = (await call_rpc(conn, { keymap: { getPhysicalLayouts: true } })).keymap?.getPhysicalLayouts;
  const physicalKeyCount = layouts?.layouts[layouts.activeLayoutIndex]?.keys.length ?? 0;
  if (physicalKeyCount < 1 || physicalKeyCount > 96) throw new Error("Unknown physical key layout.");
  const port: RuntimePort = {
    physicalKeyCount,
    combo: async request => C.Response.decode(await callRuntimePayload(conn, comboIndex, C.Request.encode(request).finish())),
    macro: async request => M.Response.decode(await callRuntimePayload(conn, macroIndex, M.Request.encode(request).finish())),
    assertUnlocked: async () => {
      const response = await call_rpc(conn, { core: { getLockState: true } });
      if (response.core?.getLockState !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) {
        throw new Error("Unlock Studio on the keyboard before runtime editing.");
      }
    },
  };
  return new RuntimeSession(port);
}
