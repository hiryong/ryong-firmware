import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
const js = buildSync({
  stdin: { contents: 'export * from "./src/ryong/runtime/device"; export * as C from "./src/ryong/runtime/proto/runtime_combo"; export * as M from "./src/ryong/runtime/proto/runtime_macro";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(import.meta.url),
  Buffer, process, console, Uint8Array, TextEncoder, Set, WeakSet, btoa, setTimeout, clearTimeout });
const { RuntimeSession, C, M } = module.exports;
const clone = value => structuredClone(value);
function fixture() {
  const state = {
    ram: { combos: [], macros: [], keymap: { layers: [], availableLayers: 8, maxLayerNameLength: 16 } }, flash: { combos: [], macros: [], keymap: { layers: [], availableLayers: 8, maxLayerNameLength: 16 } },
    locked: false, disconnected: false, writes: 0, failAt: 0, loseAckAfter: 0, dirty: false,
  };
  const statusC = () => C.Response.fromPartial({ status: { affectedCount: 1, message: "ok" } });
  const statusM = () => M.Response.fromPartial({ status: { affectedCount: 1, message: "ok" } });
  const write = () => { state.writes++; if (state.failAt === state.writes) { state.disconnected = true; throw new Error("disconnected"); } };
  const ack = () => { if (state.loseAckAfter === state.writes) { state.disconnected = true; throw new Error("lost acknowledgement"); } };
  const port = {
    physicalKeyCount: 61,
    runtimeMacroBehaviorId: 43,
    noneBehaviorId: 99,
    keymap: {
      read: async () => { if (state.disconnected) throw new Error("disconnected"); return clone(state.ram.keymap); },
      isDirty: async () => state.dirty,
      set: async (layerId, position, binding) => { write(); state.ram.keymap.layers.find(layer => layer.id === layerId).bindings[position] = clone(binding); ack(); },
      save: async () => { write(); state.flash.keymap = clone(state.ram.keymap); ack(); },
      discard: async () => { if (state.disconnected) throw new Error("disconnected"); state.ram.keymap = clone(state.flash.keymap); },
    },
    assertUnlocked: async () => { if (state.locked || state.disconnected) throw new Error("locked/disconnected"); },
    combo: async req => {
      if (state.disconnected) throw new Error("disconnected");
      if (req.listCombos) return C.Response.fromPartial({ listCombos: { combos: clone(state.ram.combos) } });
      if (req.getGlobalSettings) return C.Response.fromPartial({ getGlobalSettings: { settings: { maxCombo: 8, timeoutMs: 50 } } });
      write();
      if (req.setCombo) {
        const c = C.Combo.fromPartial({ ...req.setCombo, name: state.ram.combos.find(item => item.index === req.setCombo.index)?.name ?? "" });
        state.ram.combos = state.ram.combos.filter(item => item.index !== c.index).concat([c]);
      } else if (req.setComboName) {
        state.ram.combos.find(item => item.index === req.setComboName.index).name = req.setComboName.name;
      } else if (req.deleteCombo) {
        const c = state.ram.combos.find(item => item.index === req.deleteCombo.index);
        if (c) c.enabled = false;
      } else if (req.save) state.flash.combos = clone(state.ram.combos);
      else if (req.discard) state.ram.combos = clone(state.flash.combos);
      ack(); return statusC();
    },
    macro: async req => {
      if (state.disconnected) throw new Error("disconnected");
      if (req.listMacros) return M.Response.fromPartial({ listMacros: { macros: clone(state.ram.macros), maxMacroBytes: 256, maxNameLength: 24 } });
      if (req.getMacroGlobalSettings) return M.Response.fromPartial({ getMacroGlobalSettings: { settings: { tapMs: 30, maxEntries: 8, poolBytesTotal: 1024 } } });
      if (req.getMacro) return M.Response.fromPartial({ getMacro: { macro: clone(state.ram.macros.find(m => m.slot === req.getMacro.slot)) } });
      write();
      if (req.createMacro) {
        let slot = 0; while (state.ram.macros.some(m => m.slot === slot)) slot++;
        state.ram.macros.push(M.MacroDetail.fromPartial({ slot, name: req.createMacro.name }));
      } else if (req.setMacroStepCount) state.ram.macros.find(m => m.slot === req.setMacroStepCount.slot).steps.length = req.setMacroStepCount.stepCount;
      else if (req.appendMacroStep) state.ram.macros.find(m => m.slot === req.appendMacroStep.slot).steps.push(clone(req.appendMacroStep.step));
      else if (req.deleteMacro) {
        state.ram.macros = state.ram.macros.filter(m => m.name !== req.deleteMacro.name);
        state.flash.macros = state.flash.macros.filter(m => m.name !== req.deleteMacro.name);
      }
      else if (req.saveMacros) state.flash.macros = clone(state.ram.macros);
      else if (req.discardMacros) state.ram.macros = clone(state.flash.macros);
      ack(); return statusM();
    },
  };
  return { state, port, session: new RuntimeSession(port), restart() { state.ram = clone(state.flash); state.disconnected = false; } };
}
const desired = {
  macros: [{ name: "hello", steps: [M.MacroStep.fromPartial({ tap: { behaviorId: 42, param1: 0x70004 } })] }],
  combos: [{ ...C.Combo.fromPartial({ index: 0, name: "A+B", enabled: true, keyPositions: [1, 2], timeoutMs: 50, behavior: { behaviorId: 43 } }), macroName: "hello" }],
};
const a = fixture(); let pending; let completed = 0;
const journal = { prepare: (before, next) => { pending = { before, next }; }, complete: () => { pending = null; completed++; } };
const before = await a.session.read();
const saved = await a.session.save(before, clone(desired), journal);
assert.equal(saved.macros[0].slot, 0);
assert.equal(saved.combos[0].behavior.param1, 0);
assert.equal(completed, 1); assert.equal(pending, null);
a.restart();
assert.equal((await a.session.read()).macros[0].steps[0].tap.param1, 0x70004);

const locked = fixture(); locked.state.locked = true;
await assert.rejects(locked.session.save(before, desired, journal), /locked/);
assert.equal(locked.state.writes, 0);

const invalid = fixture();
const unsafe = clone(desired); unsafe.macros[0].steps = [M.MacroStep.fromPartial({ down: { behaviorId: 42, param1: 4 } })];
await assert.rejects(invalid.session.save(await invalid.session.read(), unsafe, journal), /left pressed/);
assert.equal(invalid.state.writes, 0);

const stale = fixture(); const old = await stale.session.read();
stale.state.ram.macros.push(M.MacroDetail.fromPartial({ slot: 3, name: "external" }));
await assert.rejects(stale.session.save(old, desired, journal), /Device changed/);
assert.equal(stale.state.writes, 0);

const journalFail = fixture();
await assert.rejects(journalFail.session.save(await journalFail.session.read(), desired, {
  prepare() { throw new Error("storage full"); }, complete() {}
}), /storage full/);
assert.equal(journalFail.state.writes, 0);

for (let failAt = 1; failAt <= 7; failAt++) {
  const f = fixture(); f.state.failAt = failAt; let recovery = false; let cleared = false;
  await assert.rejects(f.session.save(await f.session.read(), clone(desired), {
    prepare() { recovery = true; }, complete() { cleared = true; }
  }), /disconnected/);
  assert.equal(recovery, true); assert.equal(cleared, false);
  f.restart();
  // Every flash record remains decodable. Earlier writes stay RAM-only.
  const recovered = await f.session.read();
  for (const macro of recovered.macros) assert.ok(Array.isArray(macro.steps));
}
const concurrent = fixture(); const initial = await concurrent.session.read();
let release; const gate = new Promise(resolve => release = resolve);
const unlocked = concurrent.port.assertUnlocked;
concurrent.port.assertUnlocked = async () => { await gate; return unlocked(); };
const first = concurrent.session.save(initial, clone(desired), { prepare() {}, complete() {} });
await assert.rejects(concurrent.session.save(initial, desired, journal), /in progress/);
release(); await first;
console.log("PASS: runtime transactions: protocol, restart model, locked/stale/invalid writes, journal failure, 7 disconnect points, concurrent edit");

async function boundFixture() {
  const f = fixture();
  await f.session.save(await f.session.read(), clone(desired), { prepare() {}, complete() {} });
  f.state.ram.keymap.layers = [{ id: 0, name: "Base", bindings: [{ behaviorId: 43, param1: 0, param2: 0 }] }];
  f.state.flash.keymap = clone(f.state.ram.keymap); f.state.writes = 0;
  return f;
}
const renamePlan = () => {
  const next = clone(desired); next.macros[0].slot = 0; next.macros[0].name = "Renamed";
  next.combos[0].macroName = "Renamed";
  return next;
};
const rename = await boundFixture();
const renamed = await rename.session.save(await rename.session.read(), renamePlan(), { prepare() {}, complete() {} });
assert.equal(renamed.macros.length, 1); assert.equal(renamed.macros[0].name, "Renamed");
assert.notEqual(renamed.macros[0].slot, 0);
assert.equal(rename.state.flash.keymap.layers[0].bindings[0].param1, renamed.macros[0].slot);
assert.equal(rename.state.flash.combos[0].behavior.param1, renamed.macros[0].slot);
await rename.session.save(await rename.session.read(), { combos: [], macros: [] }, { prepare() {}, complete() {} });
rename.restart();
assert.equal(rename.state.flash.keymap.layers[0].bindings[0].behaviorId, 99);
assert.equal(rename.state.flash.macros.length, 0);
for (const mode of ["failAt", "loseAckAfter"]) {
  for (let point = 1; point <= 10; point++) {
    const f = await boundFixture(); f.state[mode] = point; let cleared = false;
    await assert.rejects(f.session.save(await f.session.read(), renamePlan(), { prepare() {}, complete() { cleared = true; } }));
    assert.equal(cleared, false); f.restart();
    for (const layer of f.state.flash.keymap.layers) for (const binding of layer.bindings) {
      if (binding.behaviorId === 43) assert.ok(f.state.flash.macros.some(m => m.slot === binding.param1), "durable keymap references a missing macro");
    }
    for (const combo of f.state.flash.combos) {
      if (combo.enabled && combo.behavior.behaviorId === 43) assert.ok(f.state.flash.macros.some(m => m.slot === combo.behavior.param1), "durable combo references a missing macro");
    }
  }
}
const dirty = await boundFixture(); dirty.state.dirty = true;
await assert.rejects(dirty.session.save(await dirty.session.read(), renamePlan(), { prepare() {}, complete() {} }), /Studio keymap edits/);
assert.equal(dirty.state.writes, 0);
console.log("PASS: macro rename/delete migrate keymap and combo references; 20 interruption/ACK-loss points preserve durable references");
