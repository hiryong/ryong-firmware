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
    ram: { combos: [], macros: [] }, flash: { combos: [], macros: [] },
    locked: false, disconnected: false, writes: 0, failAt: 0,
  };
  const statusC = () => C.Response.fromPartial({ status: { affectedCount: 1, message: "ok" } });
  const statusM = () => M.Response.fromPartial({ status: { affectedCount: 1, message: "ok" } });
  const write = () => { state.writes++; if (state.failAt === state.writes) { state.disconnected = true; throw new Error("disconnected"); } };
  const port = {
    physicalKeyCount: 61,
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
      return statusC();
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
      else if (req.saveMacros) state.flash.macros = clone(state.ram.macros);
      else if (req.discardMacros) state.ram.macros = clone(state.flash.macros);
      return statusM();
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
