// rpc/pipeline.ts: several requests in flight (never more than 4), answers matched by id, fixed
// answers (behavior catalog) asked once per connection, failures not remembered.
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = path.join(mkdtempSync(path.join(tmpdir(), "pipeline-")), "p.mjs");
writeFileSync(out, buildSync({ entryPoints: ["src/rpc/pipeline.ts"], bundle: true, format: "esm", platform: "node", write: false }).outputFiles[0].text);
const { call_rpc, MetaError } = await import(pathToFileURL(out).href);

function fakeConn() {
  const seen = []; let inflight = 0, maxInflight = 0, ctrl;
  const request_response_readable = new ReadableStream({ start(c) { ctrl = c; } });
  const request_writable = new WritableStream({
    write(req) {
      seen.push(req); inflight++; maxInflight = Math.max(maxInflight, inflight);
      setTimeout(() => { // the keyboard answers in order
        inflight--;
        if (req.behaviors?.getBehaviorDetails?.behaviorId === 99) ctrl.enqueue({ requestId: req.requestId, meta: { simpleError: 1 } });
        else ctrl.enqueue({ requestId: req.requestId, echo: req });
      }, 5);
    },
  });
  return { conn: { request_response_readable, request_writable, current_request: 0 }, seen, max: () => maxInflight };
}

const f = fakeConn();
const ids = Array.from({ length: 20 }, (_, i) => i);
const res = await Promise.all(ids.map((behaviorId) => call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId } } })));
res.forEach((r, i) => assert.equal(r.echo.behaviors.getBehaviorDetails.behaviorId, i, "answer matched to its request"));
assert.ok(f.max() > 4, `many in flight (${f.max()})`);
assert.deepEqual(f.seen.map(r=>r.behaviors.getBehaviorDetails.behaviorId), ids, "sent in call order");
await call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 3 } } });
assert.equal(f.seen.length, 20, "catalog answers remembered");
await call_rpc(f.conn, { keymap: { getKeymap: true } });
await call_rpc(f.conn, { keymap: { getKeymap: true } });
assert.equal(f.seen.length, 22, "the keymap is always read from the keyboard");
await call_rpc(f.conn, { keymap: { setLayerBinding: { layerId: 0, keyPosition: 0, binding: { behaviorId: 1, param1: 4, param2: 0 } } } });
await call_rpc(f.conn, { keymap: { getKeymap: true } });
assert.equal(f.seen.length, 24, "after a change the keymap is asked again");
await assert.rejects(call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 99 } } }), MetaError);
await assert.rejects(call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 99 } } }), MetaError);
assert.equal(f.seen.length, 26, "failures not remembered");
// byte budget: big requests wait, order kept
const g = fakeConn();
const bigs = Array.from({ length: 6 }, (_, i) => call_rpc(g.conn, { custom: { call: { subsystemIndex: 1, payload: new Uint8Array(150).fill(i) } } }));
await Promise.all(bigs);
assert.ok(g.max() <= 3, `byte budget respected (${g.max()})`);
assert.deepEqual(g.seen.map(r=>r.custom.call.payload[0]), [0,1,2,3,4,5]);
// identical reads in flight are shared; a write in between asks again
const h = fakeConn();
await Promise.all([call_rpc(h.conn,{keymap:{getKeymap:true}}), call_rpc(h.conn,{keymap:{getKeymap:true}})]);
assert.equal(h.seen.length, 1, "shared");
console.log("PASS: pipelined RPC window, id matching, catalog cache, errors");
