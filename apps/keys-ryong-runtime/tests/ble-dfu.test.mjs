// Wireless (Web Bluetooth) firmware install: package checks and the legacy DFU exchange,
// against a simulated Adafruit/Nordic legacy bootloader. No Bluetooth hardware is touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildSync} from "esbuild";
import vm from "node:vm";
import {zipSync, strToU8} from "fflate";

const js = buildSync({stdin: {contents: 'export * from "./src/ryong/runtime/webUpdate/bleDfu";export * from "./src/ryong/runtime/webUpdate/bleDfuPackage";', resolveDir: process.cwd()},
  bundle: true, platform: "node", format: "cjs", write: false}).outputFiles[0].text;
const module = {exports: {}};
vm.runInNewContext(js, {module, exports: module.exports, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Error, JSON, Object, Math, Number, Promise, setTimeout, clearTimeout});
const {readBleDfuPackage, sendApplication, PACKET_BYTES, PACKETS_PER_RECEIPT} = module.exports;

// 1. a real package from adafruit-nrfutil 0.5.3.post16 (dfu genpkg --dev-type 0x0052 --sd-req 0xFFFE)
const fixture = new Uint8Array(fs.readFileSync("tests/fixtures/ble-dfu-test-bluetooth.zip"));
const pkg = readBleDfuPackage("bt60-r123-abcdef0-bluetooth.zip", fixture);
assert.equal(pkg.application.length, 100); assert.equal(pkg.init.length, 14); assert.equal(pkg.target, "bt60");
assert.equal(readBleDfuPackage("bt60-oreo-r9-x-bluetooth.zip", fixture).target, "bt60-oreo");
assert.equal(readBleDfuPackage("other.zip", fixture).target, null);

// refused packages
const parts = {}; for (const [k, v] of Object.entries((await import("fflate")).unzipSync(fixture))) parts[k] = v;
const manifest = JSON.parse(new TextDecoder().decode(parts["manifest.json"]));
const rezip = (m, extra = {}) => zipSync({...parts, "manifest.json": strToU8(JSON.stringify(m)), ...extra});
assert.throws(() => readBleDfuPackage("x.zip", rezip({manifest: {...manifest.manifest, softdevice_bootloader: {bin_file: "app.bin", dat_file: "app.dat"}}})), /more than the keyboard firmware/);
const bad = parts["app.bin"].slice(); bad[0] ^= 1;
assert.throws(() => readBleDfuPackage("x.zip", zipSync({...parts, "app.bin": bad})), /checksum/);
assert.throws(() => readBleDfuPackage("x.zip", new Uint8Array([1, 2, 3])), /not a zip/);
const wrongType = parts["app.dat"].slice(); wrongType[0] = 0x51;
assert.throws(() => readBleDfuPackage("x.zip", zipSync({...parts, "app.dat": wrongType})), /nRF52/);

// 2. the exchange, against a simulated legacy bootloader
function bootloader({version = 8, refuse = null, dropReceipt = false} = {}) {
  const log = [], notes = []; let state = "idle", expectSize = false, init = [], image = [], prn = 0, sinceReceipt = 0, size = 0;
  const say = (...b) => notes.push(new Uint8Array(b));
  const link = {
    version: async () => version,
    control: async (b) => {
      log.push(["cp", ...b]);
      const op = b[0];
      if (op === 1) { assert.equal(b[1], 4, "only application mode is ever requested"); expectSize = true; }
      else if (op === 2 && b[1] === 0) state = "init";
      else if (op === 2 && b[1] === 1) { state = "idle"; say(0x10, 2, refuse === 2 ? 6 : 1); }
      else if (op === 8) prn = b[1] | (b[2] << 8);
      else if (op === 3) state = "image";
      else if (op === 4) say(0x10, 4, image.length === size ? 1 : 5);
      else if (op === 5) state = "activated";
    },
    packet: async (b) => {
      assert.ok(b.length <= 20, "packets fit the 23-byte MTU");
      if (expectSize) { expectSize = false; const v = new DataView(b.buffer, b.byteOffset); assert.equal(v.getUint32(0, true), 0); assert.equal(v.getUint32(4, true), 0); size = v.getUint32(8, true); say(0x10, 1, refuse === 1 ? 2 : 1); return; }
      if (state === "init") { init.push(...b); return; }
      image.push(...b); sinceReceipt++;
      if (image.length === size) say(0x10, 3, 1);
      else if (prn && sinceReceipt === prn) { sinceReceipt = 0; if (!dropReceipt) { const r = new Uint8Array(5); r[0] = 0x11; new DataView(r.buffer).setUint32(1, image.length, true); notes.push(r); } }
    },
    next: async () => { if (!notes.length) throw Error("timeout (simulated)"); return notes.shift(); },
  };
  return {link, log, get image() { return new Uint8Array(image); }, get init() { return new Uint8Array(init); }, get state() { return state; }};
}

// a larger image so receipts happen several times
const big = {...pkg, application: Uint8Array.from({length: 1000}, (_, i) => (i * 13) & 255)};
const b1 = bootloader(), stages = [];
await sendApplication(big, b1.link, (s, n, t) => stages.push(s === "sending" ? `${s}:${n}/${t}` : s));
assert.deepEqual(Array.from(b1.image), Array.from(big.application), "the bootloader received exactly the image");
assert.deepEqual(Array.from(b1.init), Array.from(pkg.init), "and the init packet");
assert.equal(b1.state, "activated");
assert.deepEqual(b1.log.map((l) => l.slice(0, 2).join(",")), ["cp,1", "cp,2", "cp,2", "cp,8", "cp,3", "cp,4", "cp,5"]);
assert.deepEqual(b1.log[3], ["cp", 8, PACKETS_PER_RECEIPT, 0]);
assert.equal(stages.at(-1), "done"); assert.ok(stages.includes("sending:1000/1000"));
assert.equal(PACKET_BYTES, 20);

// refusals stop with the reason; nothing is retried
await assert.rejects(sendApplication(big, bootloader({refuse: 1}).link, () => {}), /refused step 1: invalid state/);
const b2 = bootloader({refuse: 2});
await assert.rejects(sendApplication(big, b2.link, () => {}), /refused step 2: operation failed/);
assert.equal(b2.log.filter((l) => l[1] === 3).length, 0, "no image after a refused init packet");
await assert.rejects(sendApplication(big, bootloader({dropReceipt: true}).link, () => {}), /timeout/);
await assert.rejects(sendApplication(big, bootloader({version: 4}).link, () => {}), /too old/);
console.log("PASS: real adafruit-nrfutil package read and checked (app only, CRC, device type, target from name), legacy DFU exchange against a simulated bootloader (order, app-only start, 20-byte packets, receipts every", PACKETS_PER_RECEIPT + ", validate, activate), refusals and missing receipts stop without retry");
