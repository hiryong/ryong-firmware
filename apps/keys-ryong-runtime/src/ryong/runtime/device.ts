import { AdvancedPort, AdvancedState, AdvancedDesired, readAdvanced, validateAdvanced, saveAdvanced } from "./advanced";
import * as T from "./proto/runtime_tapdance";
import * as H from "./proto/holdtap";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../rpc/pipeline";
import type { Keymap, BehaviorBinding as KeymapBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
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
  keymap?: Keymap;
  advanced?: AdvancedState;
};
export type DesiredMacro = { slot?: number; name: string; steps: M.MacroStep[] };
export type DesiredCombo = C.Combo & { macroName?: string; danceName?:string };
export type DesiredProfile = { combos: DesiredCombo[]; macros: DesiredMacro[]; advanced?: AdvancedDesired };
export type RuntimePort = {
  advanced?: AdvancedPort;
  runtimeDanceBehaviorId?: number;
  physicalKeyCount: number;
  runtimeMacroBehaviorId?: number;
  noneBehaviorId?: number;
  keymap?: {
    read: () => Promise<Keymap>;
    isDirty: () => Promise<boolean>;
    set: (layerId: number, position: number, binding: KeymapBinding) => Promise<void>;
    save: () => Promise<void>;
    discard: () => Promise<void>;
  };
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
    // Everything at once: the connection keeps many requests in flight (rpc/pipeline.ts), and over
    // Bluetooth each wait costs a round trip.
    const advancedP = this.port.advanced ? readAdvanced(this.port.advanced) : Promise.resolve(undefined);
    const keymapP = this.port.keymap ? this.port.keymap.read() : Promise.resolve(undefined);
    advancedP.catch(() => {}); keymapP.catch(() => {});
    const [combos, comboLimits, macros, macroLimits] = await Promise.all([
      this.port.combo(C.Request.fromPartial({ listCombos: {} })),
      this.port.combo(C.Request.fromPartial({ getGlobalSettings: {} })),
      this.port.macro(M.Request.fromPartial({ listMacros: {} })),
      this.port.macro(M.Request.fromPartial({ getMacroGlobalSettings: {} })),
    ]);
    for (const response of [combos, comboLimits, macros, macroLimits]) check(response);
    if (!combos.listCombos || !comboLimits.getGlobalSettings?.settings ||
        !macros.listMacros || !macroLimits.getMacroGlobalSettings?.settings) {
      throw new Error("Incomplete runtime capability response.");
    }
    const details: M.MacroDetail[] = (await Promise.all(macros.listMacros.macros.map((summary) =>
      this.port.macro(M.Request.fromPartial({ getMacro: { slot: summary.slot } }))))).map((response, i) => {
      check(response);
      const slot = macros.listMacros!.macros[i].slot;
      if (!response.getMacro?.macro || response.getMacro.macro.slot !== slot) {
        throw new Error("Macro slot changed while reading. Reload the device.");
      }
      return response.getMacro.macro;
    });
    const [advanced, keymap] = await Promise.all([advancedP, keymapP]);
    return {
      combos: combos.listCombos.combos,
      macros: details,
      comboLimits: comboLimits.getGlobalSettings.settings,
      macroLimits: macroLimits.getMacroGlobalSettings.settings,
      maxMacroBytes: macros.listMacros.maxMacroBytes,
      maxNameLength: macros.listMacros.maxNameLength,
      advanced,
      keymap,
    };
  }

  /** Stage in RAM, persist only after all requested writes have succeeded.
   * Recovery journal remains pending on EVERY failure, including lost ACK.
   * Flash persistence is per module/item, not a profile-wide atomic commit.
   */
  /** Rebase only committed Studio keymap changes, preserving staged dynamic edits. */
  async refreshKeymap(before: RuntimeSnapshot): Promise<RuntimeSnapshot> {
    const current = await this.read();
    const dynamicOnly = ({ keymap: _keymap, ...runtime }: RuntimeSnapshot) => runtime;
    if (canonical(dynamicOnly(current)) !== canonical(dynamicOnly(before))) {
      throw new Error("Dynamic settings changed. Export your edits, reload, then review the backup.");
    }
    if (this.port.keymap && await this.port.keymap.isDirty()) {
      throw new Error("Save or discard keymap changes in Keymap before saving dynamic settings.");
    }
    return { ...before, keymap: current.keymap };
  }

  async save(before: RuntimeSnapshot, desired: DesiredProfile, journal: RecoveryJournal) {
    if (occupied.has(this.port)) throw new Error("Another runtime save is in progress.");
    occupied.add(this.port);
    let mutationStarted = false;
    try {
      await this.port.assertUnlocked();
      const current = await this.read();
      if (canonical(current) !== canonical(before)) throw new Error("Device changed. Reload before saving.");
      this.validate(before, desired);
      const migration = before.macros.some(old => !desired.macros.some(next => next.slot === old.slot && next.name === old.name));
      if (migration && await this.port.keymap!.isDirty()) throw new Error("Save or discard existing Studio keymap edits before renaming/deleting a macro.");
      journal.prepare(before, desired); // must succeed before any device mutation
      mutationStarted = true;
      for (const macro of desired.macros) {
        const old = before.macros.find(item => item.slot === macro.slot);
        let slot = old?.name === macro.name ? macro.slot : undefined;
        if (slot !== undefined && canonical(old?.steps) === canonical(macro.steps)) continue;
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
      // Persist macro bodies before dances can point at their slots. Dances
      // precede combos and removal of old macros, preserving durable references.
      check(await this.port.macro(M.Request.fromPartial({ saveMacros: {} })));
      if (desired.advanced && before.advanced && this.port.advanced) {
        const advanced = structuredClone(desired.advanced);
        for(const d of advanced.dances) for(const b of d.bindings) if(b.macroName) {
          const m=macroCatalog.listMacros?.macros.find(m=>m.name===b.macroName);
          if(!m)throw new Error("Tap Dance macro has no confirmed slot.");
          b.param1=m.slot;delete b.macroName;
        }
        await this.port.assertUnlocked();
        await saveAdvanced(this.port.advanced,before.advanced,advanced);
      }
      const advancedNow = this.port.advanced ? await readAdvanced(this.port.advanced) : undefined;
      const resolvedCombos = desired.combos.map(combo => {
        if(combo.danceName) {
          const dance=advancedNow?.dances.find(d=>d.name===combo.danceName);
          if(!dance || !combo.behavior)throw new Error("Combo Tap Dance has no confirmed ID.");
          return {...combo,behavior:{...combo.behavior,param1:dance.index}};
        }
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
      check(await this.port.combo(C.Request.fromPartial({ save: {} })));
      const removed = before.macros.filter(old => !desired.macros.some(next => next.slot === old.slot && next.name === old.name));
      if (removed.length) {
        const keymap = this.port.keymap!;
        const currentKeymap = await keymap.read();
        if (canonical(currentKeymap) !== canonical(before.keymap)) throw new Error("Keymap changed during save; old macro slots retained.");
        const expected: Keymap = structuredClone(currentKeymap);
        let changed = false;
        for (const layer of expected.layers) {
          for (let position = 0; position < layer.bindings.length; position++) {
            const binding = layer.bindings[position];
            const old = removed.find(macro => binding.behaviorId === this.port.runtimeMacroBehaviorId && binding.param1 === macro.slot);
            if (!old) continue;
            const renamed = desired.macros.find(macro => macro.slot === old.slot);
            const replacementSlot = renamed
              ? macroCatalog.listMacros?.macros.find(macro => macro.name === renamed.name)?.slot : undefined;
            if (renamed && replacementSlot === undefined) throw new Error("Replacement macro slot is unconfirmed.");
            const next: KeymapBinding = renamed ? { ...binding, param1: replacementSlot! }
              : { behaviorId: this.port.noneBehaviorId!, param1: 0, param2: 0 };
            await keymap.set(layer.id, position, next);
            layer.bindings[position] = next; changed = true;
          }
        }
        if (changed) {
          await keymap.save();
          if (canonical(await keymap.read()) !== canonical(expected)) throw new Error("Keymap reference migration failed readback; old macro slots retained.");
        }
        // References are durable before the old macro is finally removed.
        for (const old of removed) check(await this.port.macro(M.Request.fromPartial({ deleteMacro: { name: old.name } })));
      }
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
            (macro.slot !== undefined && before.macros.find(old => old.slot === macro.slot)?.name === macro.name && actual.slot !== macro.slot)) {
          throw new Error("Persisted macro readback differs. Recovery journal retained.");
        }
      }
      if (result.macros.length !== desired.macros.length ||
          result.combos.some(combo => combo.enabled && !desired.combos.some(item => item.index === combo.index))) {
        throw new Error("Device profile changed during final readback.");
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
          if (this.port.advanced) await this.port.advanced.dance(T.Request.fromPartial({discard:{}}));
          if (this.port.keymap) await this.port.keymap.discard();
        } catch { /* connection may be gone; journal is still pending */ }
      }
      throw error;
    } finally {
      occupied.delete(this.port);
    }
  }

  validate(before: RuntimeSnapshot, desired: DesiredProfile) {
    if (desired.advanced) {
      if (!before.advanced || !this.port.advanced) throw new Error("Advanced runtime capability missing.");
      validateAdvanced(before.advanced, desired.advanced, this.port.runtimeMacroBehaviorId, this.port.runtimeDanceBehaviorId);
      for(const d of desired.advanced.dances) for(const b of d.bindings) if(b.macroName && !desired.macros.some(m=>m.name===b.macroName))throw new Error("Unknown Tap Dance macro reference.");
    }
    // Existing external dance->macro links cannot be silently invalidated.
    if (!desired.advanced && before.advanced?.dances.some(d => [d.config?.singleBinding,d.config?.doubleBinding,d.config?.tripleBinding].some(b => b?.behaviorId === this.port.runtimeMacroBehaviorId)) &&
        before.macros.some(m=>!desired.macros.some(n=>n.slot===m.slot && n.name===m.name))) throw new Error("Remove Tap Dance macro references before renaming/deleting macros.");
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
            slots.has(macro.slot) || !before.macros.some(old => old.slot === macro.slot)) {
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
            if (binding.behaviorId === this.port.runtimeMacroBehaviorId) throw new Error("Nested runtime macros are not enabled.");
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
      if(combo.danceName && !desired.advanced?.dances.some(d=>d.name===combo.danceName))throw new Error("Unknown combo dance reference.");
      if (combo.macroName && !desired.macros.some(macro => macro.name === combo.macroName)) throw new Error("Unknown combo macro reference.");
      if (combo.behavior.behaviorId === this.port.runtimeMacroBehaviorId && !combo.macroName &&
          !desired.macros.some(macro => macro.slot === combo.behavior!.param1 && before.macros.find(old => old.slot === macro.slot)?.name === macro.name)) {
        throw new Error("Combo points at an unconfirmed macro slot.");
      }
      comboSlots.add(combo.index);
    }
    const newSlots = desired.macros.filter(macro => macro.slot === undefined ||
      before.macros.find(old => old.slot === macro.slot)?.name !== macro.name);
    if (before.macros.length + newSlots.length > before.macroLimits.maxEntries) {
      throw new Error("A free temporary macro slot is required for safe creation/rename.");
    }
    for (const macro of newSlots) {
      if (before.macros.some(old => old.name === macro.name)) throw new Error("Macro name already exists on the device.");
    }
    const removed = before.macros.filter(old => !desired.macros.some(next => next.slot === old.slot && next.name === old.name));
    if (removed.length && (!this.port.keymap || !before.keymap || !this.port.runtimeMacroBehaviorId || !this.port.noneBehaviorId)) {
      throw new Error("Keymap reference migration is unavailable; no macros were deleted or renamed.");
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
    advanced: subsystems.some(s=>s.identifier === "cormoran__runtime_tapdance") && subsystems.some(s=>s.identifier === "zmk__holdtap") ? {
      dance: async request => T.Response.decode(await callRuntimePayload(conn,find("cormoran__runtime_tapdance"),T.Request.encode(request).finish())),
      hold: async request => H.Response.decode(await callRuntimePayload(conn,find("zmk__holdtap"),H.Request.encode(request).finish())),
    } : undefined,
    keymap: {
      read: async () => {
        const value = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap?.getKeymap;
        if (!value) throw new Error("Missing keymap response.");
        return value;
      },
      isDirty: async () => {
        const value = (await call_rpc(conn, { keymap: { checkUnsavedChanges: true } })).keymap?.checkUnsavedChanges;
        if (value === undefined) throw new Error("Missing keymap dirty-state response.");
        return value;
      },
      set: async (layerId, keyPosition, binding) => {
        const value = (await call_rpc(conn, { keymap: { setLayerBinding: { layerId, keyPosition, binding } } })).keymap?.setLayerBinding;
        if (value !== 0) throw new Error("Keymap binding migration rejected.");
      },
      save: async () => {
        const value = (await call_rpc(conn, { keymap: { saveChanges: true } })).keymap?.saveChanges;
        if (!value?.ok || value.err) throw new Error("Keymap persistence failed.");
      },
      discard: async () => {
        const value = (await call_rpc(conn, { keymap: { discardChanges: true } })).keymap?.discardChanges;
        if (!value) throw new Error("Keymap discard failed.");
      },
    },
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

