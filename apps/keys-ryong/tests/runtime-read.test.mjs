import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const file = new URL("../src/ryong/runtime/customRpc.ts", import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function adapter(modern, rpc, codec) {
  const Request = {
    fromJSON: value => modern ? value : {},
    encode: value => ({ finish: () => new TextEncoder().encode(JSON.stringify(value)) }),
    decode: bytes => JSON.parse(new TextDecoder().decode(bytes))
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: () => ({ Request: codec ?? Request, call_rpc: rpc }), Uint8Array,
    Set, Error, Number, Array
  });
  return exports;
}
let calls = [];
const conn = {};
const old = adapter(false, async req => { calls.push(req); });
await assert.rejects(old.readRuntimeCatalogs(conn), /No request was sent/);
assert.equal(calls.length, 0);

const catalog = [
  { index: 11, identifier: "cormoran__runtime_macro" },
  { index: 7, identifier: "cormoran__runtime_combo" }
];
const modern = adapter(true, async (connection, req) => {
  assert.equal(connection, conn);
  calls.push(req);
  if (req.custom.listCustomSubsystems) {
    return { custom: { listCustomSubsystems: { subsystems: catalog } } };
  }
  assert.equal(req.custom.call.payload, "CgA=");
  return { custom: { call: {
    subsystemIndex: req.custom.call.subsystemIndex, payload: new Uint8Array([18, 0])
  } } };
});
const data = await modern.readRuntimeCatalogs(conn);
assert.deepEqual([...data.combos], [18, 0]);
assert.deepEqual(calls.slice(1).map(req => req.custom.call.subsystemIndex), [7, 11]);

calls = [];
const missing = adapter(true, async () => {
  calls.push(1);
  return { custom: { listCustomSubsystems: { subsystems: catalog.slice(0, 1) } } };
});
await assert.rejects(missing.readRuntimeCatalogs(conn), /Missing runtime subsystem/);
assert.equal(calls.length, 1);

const duplicate = adapter(true, async () => ({
  custom: { listCustomSubsystems: { subsystems: [catalog[0], catalog[0]] } }
}));
await assert.rejects(duplicate.discoverRuntime(conn), /Ambiguous/);

const locked = adapter(true, async () => { throw new Error("unlock required"); });
await assert.rejects(locked.discoverRuntime(conn), /unlock required/);
const wrong = adapter(true, async (_conn, req) => req.custom.listCustomSubsystems ?
  { custom: { listCustomSubsystems: { subsystems: catalog } } } :
  { custom: { call: { subsystemIndex: 99, payload: new Uint8Array() } } });
await assert.rejects(wrong.readRuntimeCatalogs(conn), /Invalid runtime catalog/);
console.log("PASS: runtime read adapter: old codec, discovery, indices, malformed response, lock rejection");

const bundledClient = buildSync({
  stdin: { contents: 'export { Request } from "@zmkfirmware/zmk-studio-ts-client/index";',
           resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "cjs", write: false
}).outputFiles[0].text;
const clientModule = { exports: {} };
vm.runInNewContext(bundledClient, {
  module: clientModule, exports: clientModule.exports,
  require: createRequire(import.meta.url), Buffer, process, console,
  setTimeout, clearTimeout, Uint8Array
});
let actualCalls = 0;
const actual = adapter(false, async () => { actualCalls++; }, clientModule.exports.Request);
await assert.rejects(actual.discoverRuntime(conn), /No request was sent/);
assert.equal(actualCalls, 0);
console.log("PASS: installed upstream codec also fails closed before I/O");
