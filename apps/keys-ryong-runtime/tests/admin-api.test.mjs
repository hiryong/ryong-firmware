// Admin API (Cloudflare Pages Functions) against a fake GitHub: sign-in, guards, build dispatch,
// bench-test records and the release gate. No network.
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "admin-api-"));
const load = async (rel) => {
  const out = path.join(dir, rel.replace(/[\/\[\]]/g, "_") + ".mjs");
  const js = buildSync({ entryPoints: [path.resolve("admin-functions", rel)], bundle: true, format: "esm", platform: "neutral", write: false }).outputFiles[0].text;
  writeFileSync(out, js);
  return import(pathToFileURL(out).href);
};
const mw = await load("api/admin/_middleware.ts");
const h = {
  me: await load("api/admin/me.ts"), login: await load("api/admin/login.ts"), logout: await load("api/admin/logout.ts"),
  builds: await load("api/admin/builds/index.ts"), build: await load("api/admin/builds/[id].ts"), download: await load("api/admin/builds/[id]/download.ts"),
  validation: await load("api/admin/validation/[id].ts"), releases: await load("api/admin/releases.ts"), overview: await load("api/admin/overview.ts"),
};

/* ---------- fake GitHub ---------- */
const SHA = "a".repeat(64);
const gh = {
  runs: [{ id: 101, display_title: "Firmware build · bt60 · test · req-0001", status: "completed", conclusion: "success", html_url: "https://github.com/x/101",
    created_at: new Date().toISOString(), updated_at: "", head_sha: "f".repeat(40), head_branch: "dev", path: ".github/workflows/firmware-build.yml", event: "workflow_dispatch" }],
  files: new Map(), releases: new Set(), dispatches: [], calls: [],
};
const reply = (data, status = 200, headers = {}) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url), p = url.pathname, m = (init.method || "GET").toUpperCase();
  gh.calls.push(`${m} ${p}`);
  assert.equal(new Headers(init.headers).get("Authorization"), "Bearer ghp_test", "server token used");
  if (p.endsWith("/dispatches")) {
    const body = JSON.parse(init.body);
    gh.dispatches.push({ p, body });
    if (p.includes("firmware-build.yml")) gh.runs.unshift({ ...gh.runs.at(-1), id: 200 + gh.dispatches.length, display_title: `Firmware build · ${body.inputs.target} · ${body.inputs.label} · ${body.inputs.request_id}`, status: "queued", conclusion: null });
    return reply(null, 204);
  }
  let r;
  if ((r = /\/actions\/workflows\/([\w.-]+)\/runs$/.exec(p))) return reply({ workflow_runs: r[1] === "firmware-build.yml" ? gh.runs : [] });
  if ((r = /\/actions\/runs\/(\d+)\/artifacts$/.exec(p))) return reply({ artifacts: Number(r[1]) === 101 ? [{ id: 9, name: `firmware-bt60-${SHA}`, expired: false, size_in_bytes: 1000, expires_at: "" }] : [] });
  if ((r = /\/actions\/runs\/(\d+)$/.exec(p))) { const run = gh.runs.find((x) => x.id === Number(r[1])); return run ? reply(run) : reply({ message: "Not Found" }, 404); }
  if (/\/actions\/artifacts\/9\/zip$/.test(p)) return new Response(null, { status: 302, headers: { Location: "https://download.example/zip" } });
  if ((r = /\/releases\/tags\/(.+)$/.exec(p))) return gh.releases.has(r[1]) ? reply({}) : reply({ message: "Not Found" }, 404);
  if ((r = /\/contents\/(.+)$/.exec(p))) {
    const file = r[1];
    if (m === "PUT") {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, "firmware-registry");
      const prev = gh.files.get(file);
      if (prev && body.sha !== prev.sha) return reply({ message: "sha mismatch" }, 409);
      gh.files.set(file, { content: body.content, sha: "s" + Math.random() });
      return reply({ content: {} }, 201);
    }
    assert.equal(url.searchParams.get("ref"), "firmware-registry");
    if (file === "validation") return reply([...gh.files.keys()].filter((k) => k.startsWith("validation/")).map((k) => ({ name: k.slice(11) })));
    const f = gh.files.get(file);
    return f ? reply(f) : reply({ message: "Not Found" }, 404);
  }
  return reply({ message: "unexpected " + p }, 500);
};

/* ---------- request helpers ---------- */
const PASSWORD = "correct horse battery";
const env = { ADMIN_PASSWORD: PASSWORD, ADMIN_GITHUB_TOKEN: "ghp_test" };
let cookie = "";
async function call(handler, method, urlPath, { body, params = {}, headers = {}, e = env } = {}) {
  const req = new Request("https://keysbeta.ryong.com" + urlPath, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Cookie: cookie, "CF-Connecting-IP": "1.2.3.4", ...(method !== "GET" ? { "X-Ryong-Admin": "1" } : {}), ...headers } });
  const ctx = { request: req, env: e, params, next: () => handler(ctxFor) };
  const key = { GET: "onRequestGet", POST: "onRequestPost", PUT: "onRequestPut" }[method];
  const ctxFor = { request: req, env: e, params };
  ctx.next = async () => handler[key] ? handler[key](ctxFor) : new Response(null, { status: 405 });
  const res = await mw.onRequest(ctx);
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

/* ---------- sign-in ---------- */
let r = await call(h.me, "GET", "/api/admin/me");
assert.deepEqual([r.status, r.json.signedIn, r.json.setup.password, r.json.setup.github], [200, false, "ok", true]);
assert.equal((await call(h.overview, "GET", "/api/admin/overview")).status, 401, "closed without session");
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: "wrong" } })).status, 401);
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: PASSWORD }, headers: { "X-Ryong-Admin": "" } })).status, 400, "header required");
r = await call(h.login, "POST", "/api/admin/login", { body: { password: PASSWORD } });
assert.equal(r.status, 200);
const set = r.headers.get("Set-Cookie");
assert.match(set, /HttpOnly; Secure; SameSite=Strict/);
assert.match(set, /Path=\/api\/admin/);
cookie = set.split(";")[0];
assert.equal((await call(h.me, "GET", "/api/admin/me")).json.signedIn, true);
// tampered / other password / no password configured
const good = cookie;
cookie = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
assert.equal((await call(h.overview, "GET", "/api/admin/overview")).status, 401, "tampered cookie");
cookie = good;
assert.equal((await call(h.overview, "GET", "/api/admin/overview", { e: { ...env, ADMIN_PASSWORD: "another long password" } })).status, 401, "password change signs out");
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: "" }, e: { ADMIN_GITHUB_TOKEN: "x" } })).status, 503, "no password = closed");
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: "short" }, e: { ADMIN_PASSWORD: "short" } })).status, 503, "weak password = closed");
// lockout after repeated failures from one address
for (let i = 0; i < 5; i++) await call(h.login, "POST", "/api/admin/login", { body: { password: "nope" }, headers: { "CF-Connecting-IP": "9.9.9.9" } });
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: PASSWORD }, headers: { "CF-Connecting-IP": "9.9.9.9" } })).status, 429);

// a secret pasted with a trailing newline still works, and so does a typed trailing space
assert.equal((await call(h.login, "POST", "/api/admin/login", { body: { password: PASSWORD + " " }, e: { ...env, ADMIN_PASSWORD: PASSWORD + "\n" } })).status, 200);

/* ---------- builds ---------- */
assert.equal((await call(h.builds, "POST", "/api/admin/builds", { body: { target: "esp32" } })).status, 400);
assert.equal((await call(h.builds, "POST", "/api/admin/builds", { body: { target: "bt60", idle_timeout_s: 5 } })).status, 400);
assert.equal((await call(h.builds, "POST", "/api/admin/builds", { body: { target: "bt60", label: "x;rm -rf" } })).status, 400);
r = await call(h.builds, "POST", "/api/admin/builds", { body: { target: "bt60", label: "절전 테스트", sleep_min: 10, tx_power: "plus8" } });
assert.equal(r.status, 200);
assert.ok(r.json.id > 200, "found the dispatched run");
const d = gh.dispatches.at(-1).body;
assert.equal(d.ref, "dev/keys-ryong-runtime");
assert.deepEqual(Object.keys(d.inputs).sort(), ["debounce_press_ms", "debounce_release_ms", "idle_timeout_s", "label", "request_id", "sleep_min", "target", "tx_power"]);
assert.ok(Object.values(d.inputs).every((v) => typeof v === "string"));
r = await call(h.builds, "GET", "/api/admin/builds");
assert.equal(r.json.builds.find((b) => b.id === 101).target, "bt60");

/* ---------- bench-test record ---------- */
r = await call(h.build, "GET", "/api/admin/builds/101", { params: { id: "101" } });
assert.equal(r.json.artifact.uf2_sha256, SHA);
assert.ok(r.json.blockers.beta.includes("실기 검증 기록이 없어요."));
assert.equal((await call(h.download, "GET", "/api/admin/builds/101/download", { params: { id: "101" } })).headers.get("Location"), "https://download.example/zip");
const allPass = { boots: "pass", all_keys: "pass", usb_typing: "pass", ble_pair: "pass", ble_switch: "pass", studio_save: "pass", runtime_features: "pass", device_settings: "pass", sleep_wake: "pass", recovery: "pass" };
r = await call(h.validation, "PUT", "/api/admin/validation/101", { params: { id: "101" }, body: { tested_board: "bt60", items: { ...allPass, recovery: "skip" }, result: "pass", uf2_sha256: "evil" } });
assert.equal(r.status, 200);
assert.equal(r.json.record.result, "incomplete", "server computes the result");
assert.equal(r.json.record.uf2_sha256, SHA, "hash comes from the build, not the browser");
r = await call(h.releases, "POST", "/api/admin/releases", { body: { run_id: 101, channel: "beta" } });
assert.equal(r.status, 409);
assert.ok(r.json.blockers.length);
assert.equal(gh.dispatches.filter((x) => x.p.includes("firmware-release.yml")).length, 0, "nothing dispatched while blocked");
// wrong board
await call(h.validation, "PUT", "/api/admin/validation/101", { params: { id: "101" }, body: { tested_board: "ryong60", items: allPass } });
assert.ok((await call(h.releases, "POST", "/api/admin/releases", { body: { run_id: 101, channel: "beta" } })).json.blockers.some((x) => x.includes("대상 보드")));
// all required pass on the right board → beta allowed, stable not yet
r = await call(h.validation, "PUT", "/api/admin/validation/101", { params: { id: "101" }, body: { tested_board: "bt60", items: allPass, notes: "ok" } });
assert.equal(r.json.record.result, "pass");
assert.equal(r.json.record.stable_ready, false);
r = await call(h.releases, "POST", "/api/admin/releases", { body: { run_id: 101, channel: "stable" } });
assert.ok(r.json.blockers.some((x) => x.includes("베타")));
r = await call(h.releases, "POST", "/api/admin/releases", { body: { run_id: 101, channel: "beta" } });
assert.equal(r.status, 200);
assert.deepEqual(gh.dispatches.at(-1).body.inputs, { build_run_id: "101", channel: "beta" });
gh.releases.add("fw-bt60-beta-r101");
assert.ok((await call(h.releases, "POST", "/api/admin/releases", { body: { run_id: 101, channel: "beta" } })).json.blockers.some((x) => x.includes("이미")));
// a run that isn't an admin build is refused
gh.runs.push({ ...gh.runs.at(-1), id: 300, path: ".github/workflows/zmk-validation.yml" });
assert.equal((await call(h.build, "GET", "/api/admin/builds/300", { params: { id: "300" } })).status, 404);
assert.equal((await call(h.validation, "PUT", "/api/admin/validation/abc", { params: { id: "abc" }, body: {} })).status, 400);

/* ---------- logout ---------- */
r = await call(h.logout, "POST", "/api/admin/logout");
assert.match(r.headers.get("Set-Cookie"), /Max-Age=0/);
console.log("PASS: admin API sign-in/lockout/cookie tamper, server-side settings validation, dispatch, server-computed bench records, release gate, no dispatch while blocked");
