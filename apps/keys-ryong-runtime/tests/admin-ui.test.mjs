// /admin in a real browser against a mocked /api/admin (no network, no GitHub).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const pw = await import(process.env.RYONG_PLAYWRIGHT ?? "playwright");
const root = path.resolve("dist-runtime");
const output = path.resolve("ui-verification/admin");
await fs.mkdir(output, { recursive: true });
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  try {
    let p = new URL(req.url, "http://x").pathname;
    if (p === "/admin" || p === "/admin/") p = "/admin/index.html";
    const f = path.resolve(root, "." + p);
    if (!f.startsWith(root + path.sep)) throw 0;
    res.setHeader("Content-Type", mime[path.extname(f)] || "application/octet-stream");
    res.end(await fs.readFile(f));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const SHA = "b".repeat(64);
let signedIn = false, record = null, released = [];
const sent = [];
const build = { id: 501, target: "bt60", label: "절전 테스트", status: "completed", conclusion: "success", at: new Date().toISOString(), sha: "abc1234", url: "https://github.com/x", validated: false };
const required = ["boots", "all_keys", "usb_typing", "ble_pair", "ble_switch", "studio_save", "runtime_features", "device_settings", "sleep_wake", "recovery"];
const blockers = (ch) => {
  const why = [];
  if (!record) return ["실기 검증 기록이 없어요."];
  if (!required.every((k) => record.items[k] === "pass")) why.push("필수 검증 항목이 아직 다 통과하지 않았어요.");
  if (ch === "stable" && !released.includes("beta")) why.push("먼저 베타로 배포해야 해요.");
  if (released.includes(ch)) why.push("이미 이 채널에 배포했어요.");
  return why;
};
const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

const browser = await pw[process.env.RYONG_BROWSER ?? "chromium"].launch();
const results = [];
for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
  signedIn = false; record = null; released = [];
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/admin/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname.replace("/api/admin", ""), m = req.method();
    if (m !== "GET") { assert.equal(req.headers()["x-ryong-admin"], "1", "mutations carry the admin header"); sent.push({ m, p, body: req.postDataJSON?.() ?? null }); }
    if (p === "/me") return json(route, { signedIn, setup: { password: "ok", github: true }, repo: "hiryong/ryong-firmware", ref: "dev/keys-ryong-runtime" });
    if (p === "/login") { const ok = req.postDataJSON().password === "a long admin password"; signedIn = ok; return json(route, ok ? { ok } : { error: "비밀번호가 맞지 않아요." }, ok ? 200 : 401); }
    if (!signedIn) return json(route, { error: "로그인이 필요해요." }, 401);
    if (p === "/logout") { signedIn = false; return json(route, { ok: true }); }
    if (p === "/overview") return json(route, { checks: [{ file: "a.yml", label: "웹앱·가상 키보드 테스트", status: "completed", conclusion: "success", url: "https://x", at: build.at, sha: "abc1234" }],
      builds: [build], channels: released.includes("beta") ? { bt60: { beta: { run_id: 501, tag: "t", uf2_sha256: SHA, released_at: build.at, url: "https://x" } } } : {} });
    if (p === "/builds" && m === "GET") return json(route, { builds: [{ ...build, validated: !!record }] });
    if (p === "/builds" && m === "POST") return json(route, { ok: true, id: 777 });
    if (p === "/builds/501") return json(route, { ...build, sha: "abc1234def", artifact: { uf2_sha256: SHA, expired: false, size: 1, expires_at: "" }, record, released, blockers: { beta: blockers("beta"), stable: blockers("stable") } });
    if (p === "/validation/501") { const b = req.postDataJSON(); record = { ...b, result: "pass", tested_at: build.at, stable_ready: false }; return json(route, { ok: true, record }); }
    if (p === "/releases") { released.push(req.postDataJSON().channel); return json(route, { ok: true }); }
    return json(route, { error: "unexpected " + p }, 500);
  });
  const tag = viewport.width < 600 ? "phone" : "desktop";
  const step = async (name, fn) => {
    try { await fn(); results.push([tag, name, true]); console.log(`ok   ${tag} ${name}`); }
    catch (e) { results.push([tag, name, false]); console.log(`FAIL ${tag} ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${output}/fail-${tag}-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
  };
  await page.goto(base + "/admin/");
  await step("sign in (wrong, then right)", async () => {
    await page.getByLabel("비밀번호").fill("nope");
    await page.getByRole("button", { name: "로그인" }).click();
    await page.getByText("비밀번호가 맞지 않아요.").waitFor();
    await page.getByLabel("비밀번호").fill("a long admin password");
    await page.getByRole("button", { name: "로그인" }).click();
    await page.getByText("웹앱·가상 키보드 테스트").waitFor();
    await page.screenshot({ path: `${output}/${tag}-1-status.png`, fullPage: true });
  });
  await step("start a build with the chosen settings", async () => {
    await page.getByRole("button", { name: "빌드", exact: true }).click();
    await page.getByRole("radio", { name: "BT60 v2" }).click();
    await page.getByLabel("이름", { exact: true }).fill("Oreo 조명 테스트");
    await page.getByLabel("Bluetooth 이름").fill("Cheeto");
    await page.getByRole("button", { name: "빌드 시작" }).click();
    await page.getByText("빌드 r777를 시작했어요", { exact: false }).waitFor();
    const b = sent.findLast((x) => x.p === "/builds").body;
    assert.equal(b.target, "bt60"); assert.equal(b.label, "Oreo 조명 테스트"); assert.equal(b.keyboard_name, "Cheeto"); assert.equal(b.idle_timeout_s, 30); assert.equal(b.tx_power, "default");
    await page.screenshot({ path: `${output}/${tag}-2-build.png`, fullPage: true });
  });
  await step("bench-test record: verdict follows the checklist, then saved", async () => {
    await page.getByRole("button", { name: "검증", exact: true }).first().click();
    await page.getByText("SHA-256 bbbbbbbbbbbbbbbb", { exact: false }).waitFor();
    await page.getByText("아직 확인할 항목이 남았어요").waitFor();
    for (const radio of await page.getByRole("radio", { name: "통과" }).all()) await radio.click();
    await page.getByText("정식 배포 가능").waitFor();
    await page.getByRole("radiogroup", { name: /배터리 잔량/ }).getByRole("radio", { name: "실패" }).click();
    await page.getByText("실패 항목 있음").waitFor();
    await page.getByRole("radiogroup", { name: /배터리 잔량/ }).getByRole("radio", { name: "안 함" }).click();
    await page.getByText("베타 배포 가능").waitFor();
    await page.getByRole("button", { name: "검증 기록 저장" }).click();
    await page.getByText("저장했어요.", { exact: false }).waitFor();
    const b = sent.findLast((x) => x.p === "/validation/501").body;
    assert.equal(b.tested_board, "bt60");
    assert.equal(b.items.battery, "skip");
    assert.ok(!("result" in b), "the browser never sends a verdict");
    await page.screenshot({ path: `${output}/${tag}-3-test.png`, fullPage: true });
  });
  await step("release to beta with confirmation; stable explains why not", async () => {
    await page.getByRole("button", { name: "배포하러 가기" }).click();
    await page.getByRole("button", { name: "베타로 배포" }).waitFor();
    await page.getByText("먼저 베타로 배포해야 해요.").waitFor();
    await page.getByRole("button", { name: "베타로 배포" }).click();
    await page.getByText("베타로 배포할까요?", { exact: false }).waitFor();
    await page.getByRole("button", { name: "배포하기", exact: true }).click();
    await page.getByText("베타 배포를 시작했어요", { exact: false }).waitFor();
    assert.deepEqual(sent.findLast((x) => x.p === "/releases").body, { run_id: 501, channel: "beta" });
    await page.screenshot({ path: `${output}/${tag}-4-release.png`, fullPage: true });
  });
  await step("no sideways scroll, no page errors", async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
  });
  await step("sign out", async () => {
    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.getByRole("button", { name: "로그인" }).waitFor();
  });
  await page.close();
}
await browser.close(); server.close();
const failed = results.filter((r) => !r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
