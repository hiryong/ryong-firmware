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
assert.ok(f.max() > 1 && f.max() <= 4, `window used (${f.max()})`);
await call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 3 } } });
assert.equal(f.seen.length, 20, "catalog answers remembered");
await call_rpc(f.conn, { keymap: { getKeymap: true } });
await call_rpc(f.conn, { keymap: { getKeymap: true } });
assert.equal(f.seen.length, 22, "keymap always asked");
await assert.rejects(call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 99 } } }), MetaError);
await assert.rejects(call_rpc(f.conn, { behaviors: { getBehaviorDetails: { behaviorId: 99 } } }), MetaError);
assert.equal(f.seen.length, 24, "failures not remembered");
console.log("PASS: pipelined RPC window, id matching, catalog cache, errors");
