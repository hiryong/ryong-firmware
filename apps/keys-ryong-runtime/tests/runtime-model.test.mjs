import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
const js = buildSync({
  stdin: { contents: 'export * from "./src/ryong/runtime/modelBridge"; export { RuntimeSession } from "./src/ryong/runtime/device"; export * as C from "./src/ryong/runtime/proto/runtime_combo"; export * as M from "./src/ryong/runtime/proto/runtime_macro"; export { gh, commitFiles } from "./src/ryong/api";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", write: false
}).outputFiles[0].text;
const module = { exports: {} }; let fetches = 0;
vm.runInNewContext(js, { module, exports: module.exports, require: createRequire(import.meta.url), Buffer,
  process, console, Uint8Array, TextEncoder, Set, WeakSet, btoa, setTimeout, clearTimeout,
  fetch: async () => { fetches++; return { ok: true, status: 200, json: async () => ({}) }; }
});
const { keyValue, compileDocument, viewDocument, RuntimeSession, C, M, gh, commitFiles } = module.exports;
const empty = () => ({ format: "ryong-behaviors", version: 1, combos: [], macros: [], tapDances: [], settings: [] });
const snapshot = {
  combos: [], macros: [], comboLimits: C.GlobalSettings.fromPartial({ maxCombo: 8, timeoutMs: 50 }),
  macroLimits: M.MacroGlobalSettings.fromPartial({ maxEntries: 8, tapMs: 30, poolBytesTotal: 1024 }),
  maxNameLength: 24, maxMacroBytes: 256,
};
const view = { snapshot, layerNames: ["Base", "Fn", "Mac"], catalog: { kp: 1, ref: 2, bt: 13, out: 14 },
  session: new RuntimeSession({ physicalKeyCount: 61 }) };
assert.equal(keyValue("A"), 0x70004);
assert.equal(keyValue("LC(A)"), 0x1070004);
assert.equal(keyValue("LS(H)"), 0x207000b);
assert.throws(() => keyValue("not-a-key"), /Unsupported key/);
const doc = empty();
doc.macros.push({ id: "new", name: "Hello", tap: 15, wait: 15, steps: [{ t: "text", text: "Hi" }] });
doc.combos.push({ id: "new-combo", name: "Macro", keys: [35, 36], layers: [], timeout: 50, binding: { b: "ref", id: "new" } });
const compiled = compileDocument(doc, view);
assert.equal(compiled.macros[0].steps.length, 8);
assert.equal(compiled.macros[0].steps[0].down.param1, 0x207000b);
assert.equal(compiled.combos[0].macroName, "Hello");
const bluetooth = empty();
bluetooth.combos.push({ id: "bt", name: "Profile", keys: [1, 2], layers: [], timeout: 50, binding: { b: "bt", cmd: "BT_SEL 3" } });
assert.equal(compileDocument(bluetooth, view).combos[0].behavior.param1, 3);
assert.equal(compileDocument(bluetooth, view).combos[0].behavior.param2, 3);
bluetooth.combos[0].binding = { b: "out", cmd: "OUT_USB" };
assert.equal(compileDocument(bluetooth, view).combos[0].behavior.param1, 1);
const bad = structuredClone(doc); bad.combos[0].keys = [1, 61];
assert.throws(() => compileDocument(bad, view), /Invalid runtime combo/);
const badLayer = structuredClone(doc); badLayer.combos[0].layers = [32];
assert.throws(() => compileDocument(badLayer, view), /Unknown combo layer/);
const nonAscii = structuredClone(doc); nonAscii.macros[0].steps[0].text = "한글";
assert.throws(() => compileDocument(nonAscii, view), /unsupported characters/);
const options = empty(); options.settings.push({ behavior: "mt", props: {} });
assert.throws(() => compileDocument(options, view), /runtime module is unavailable/);
const packed = { ...view, snapshot: { ...snapshot, macros: [M.MacroDetail.fromPartial({ slot: 0, name: "Packed",
  steps: [{ keyTapSequence: { packedKeys: new Uint8Array([0x84, 0x05]) } }] })] } };
const restored = viewDocument(packed);
assert.equal(restored.macros[0].steps.length, 2);
assert.equal(compileDocument(restored, packed).macros[0].steps.length, 1);
await assert.rejects(gh("/repos/hiryong/keys-ryong/actions", { method: "POST" }), /disabled/);
await assert.rejects(commitFiles("hiryong/keys-ryong", "main", [], "test"), /disabled/);
assert.equal(fetches, 0);
await gh("/repos/hiryong/keys-ryong");
assert.equal(fetches, 1);
console.log("PASS: editor model mapping, text timing, macro references, bounds, packed readback, protected GitHub write guard");

