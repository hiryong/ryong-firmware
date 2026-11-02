// End-to-end: drives the real web app against the in-browser virtual keyboard, the way a
// person would (clicks, typing, real keyboard presses), and checks what the simulated
// keyboard actually stored in its "flash". Simulation only — it proves the app speaks the
// protocol correctly, not that the hardware behaves.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const pw = await import(process.env.RYONG_PLAYWRIGHT ?? "playwright");
const engine = pw[process.env.RYONG_BROWSER ?? "chromium"]; // chromium (default) or webkit (Safari / iPhone engine)
const root = path.resolve(process.env.RYONG_DIST ?? "dist-runtime");
const output = path.resolve("ui-verification/virtual-e2e" + (process.env.RYONG_BROWSER ? "-" + process.env.RYONG_BROWSER : ""));
await fs.mkdir(output, { recursive: true });
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); return res.end('{"enabled":false,"app":null,"user":null,"repos":[]}'); }
  try {
    const p = new URL(req.url, "http://x").pathname;
    const f = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
    if (!f.startsWith(root + path.sep)) throw new Error("bad path");
    res.setHeader("Content-Type", mime[path.extname(f)] || "application/octet-stream");
    res.end(await fs.readFile(f));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/?runtime=1`;
const browser = await engine.launch(process.env.RYONG_CHROMIUM && !process.env.RYONG_BROWSER ? { executablePath: process.env.RYONG_CHROMIUM } : {});

const results = [];
let page, errors;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`ok   ${name} (${Date.now() - t0}ms)`); }
  catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e).split("\n")[0] });
    console.log(`FAIL ${name}: ${String(e?.message ?? e).split("\n").slice(0, 3).join(" | ")}`);
    await page.screenshot({ path: `${output}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {});
  }
}
const flash = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ryongVirtual.flash)));
const ram = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ryongVirtual.ram)));
const usage = (v) => v & 0xffff; // HID usage id from a ZMK &kp parameter

async function open(viewport, { fresh } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  await ctx.addInitScript((fresh) => {
    localStorage.setItem("ryong.lang", "ko");
    if (fresh && !sessionStorage.getItem("e2e.started")) { localStorage.removeItem("ryong.virtualKeyboard.v1"); sessionStorage.setItem("e2e.started", "1"); }
  }, !!fresh);
  page = await ctx.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(url);
  return ctx;
}
async function connect() {
  await page.getByRole("button", { name: "가상 키보드로 체험하기" }).click({ timeout: 10000 });
  await page.getByRole("button", { name: "가상 키보드: 잠금 해제 키 누르기" }).click({ timeout: 10000 });
  await page.locator("button.ry-key", { hasText: /^Q$|^Esc$/ }).first().waitFor({ timeout: 15000 });
}
const key = (pos) => page.locator("button.ry-key").nth(pos);
async function power() {
  const btn = page.getByRole("button", { name: "껐다 켜기" });
  if (!(await btn.isVisible())) await page.locator(".ry-virtual button").first().click();
  await btn.click();
  await page.getByRole("button", { name: "가상 키보드: 잠금 해제 키 누르기" }).click({ timeout: 10000 });
}
const tab = (name) => page.getByRole("button", { name: new RegExp(`^${name}( ·)?$`) }).first().click();
async function saveBehaviors() {
  await page.getByRole("button", { name: "키보드에 저장" }).click();
  await page.getByText("키보드에 저장했습니다.", { exact: false }).waitFor({ timeout: 10000 });
}

/* ---------------- desktop ---------------- */
let ctx = await open({ width: 1440, height: 900 }, { fresh: true });

await step("connect and unlock", async () => {
  await connect();
  const f = await flash();
  assert.equal(f.layers.length, 4);
  await page.screenshot({ path: `${output}/01-keymap.png` });
});

await step("Base layer shows real legends on first open", async () => {
  assert.equal(await page.getByRole("option", { name: "base" }).getAttribute("aria-selected"), "true");
  const legends = await page.locator("button.ry-key").allInnerTexts();
  assert.equal(legends.length, 61);
  assert.ok(!legends.some((l) => l.trim() === "?" || l.trim() === ""), "every key has a legend");
  assert.equal(legends[15].trim(), "Q", "DOM order follows key positions");
});

let beforeQ;
await step("keymap: change Q to Esc via the VIA grid and save", async () => {
  beforeQ = (await flash()).layers[0].bindings[15];
  await key(15).click();
  await page.getByRole("tab", { name: "기본" }).click();
  await page.locator(".ry-via-key", { hasText: /^Esc$/ }).first().click();
  const r = await ram();
  assert.equal(usage(r.layers[0].bindings[15].param1), 0x29, "RAM now Esc");
  assert.equal(usage((await flash()).layers[0].bindings[15].param1), usage(beforeQ.param1), "flash untouched before save");
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => (window.__ryongVirtual.flash.layers[0].bindings[15].param1 & 0xffff) === 0x29, null, { timeout: 5000 });
});

await step("keymap: unsaved change is lost on power cycle", async () => {
  await key(15).click();
  await page.locator(".ry-via-key", { hasText: /^Tab$/ }).first().click();
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[15].param1 & 0xffff) === 0x2b, null, { timeout: 3000 });
  await power();
  const r = await ram();
  assert.equal(usage(r.layers[0].bindings[15].param1), 0x29, "RAM back to saved Esc");
  assert.equal(await page.locator(".ry-offer").count(), 0, "no 'keys changed' offer after a normal power cycle");
  await page.waitForTimeout(500);
  assert.equal((await key(15).innerText()).trim(), "Esc", "screen shows the saved key again");
});

await step("keymap: layer switch shows the layer's own keys", async () => {
  await page.getByRole("option", { name: "raise" }).click();
  await page.waitForTimeout(400);
  assert.equal((await key(1).innerText()).trim(), "F1", "raise layer shows F1");
  await page.screenshot({ path: `${output}/02-layer-raise.png` });
  await page.getByRole("option", { name: "base" }).click();
  await page.waitForTimeout(300);
  assert.equal((await key(1).innerText()).trim(), "1");
});

await step("keymap: undo and redo", async () => {
  await key(16).click(); // W
  await page.locator(".ry-via-key", { hasText: /^E$/ }).first().click();
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[16].param1 & 0xffff) === 0x08, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Undo])").click();
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[16].param1 & 0xffff) === 0x1a, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Redo])").click();
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[16].param1 & 0xffff) === 0x08, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Discard])").click();
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[16].param1 & 0xffff) === 0x1a, null, { timeout: 3000 });
  await page.waitForFunction(() => document.querySelectorAll("button.ry-key")[16]?.innerText.trim() === "W", null, { timeout: 3000 });
});

await step("keymap: add a layer, save, remove it", async () => {
  await page.getByRole("button", { name: "레이어 추가" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.ram.layers.length === 5, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers.length === 5, null, { timeout: 3000 });
  const layerList = page.getByRole("listbox", { name: "Keymap Layer" });
  assert.equal(await layerList.getByRole("option").count(), 5);
  await layerList.getByRole("option").nth(4).click();
  await page.getByRole("button", { name: "레이어 삭제" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.ram.layers.length === 4, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers.length === 4, null, { timeout: 3000 });
  await page.getByRole("option", { name: "base" }).click();
});

await step("reload page: saved keymap survives", async () => {
  await page.reload();
  await connect();
  assert.equal(usage((await flash()).layers[0].bindings[15].param1), 0x29);
  await page.waitForTimeout(800);
  if (await page.locator(".ry-offer").count()) {
    const snap = await page.evaluate(() => JSON.parse(localStorage.getItem("ryong.snapshots") || "[]")[0]);
    const now = await flash();
    const diffs = [];
    now.layers.forEach((l, li) => l.bindings.forEach((b, i) => { const p = snap?.layers[li]?.bindings[i]; if (!p || p.param1 !== b.param1) diffs.push(`${li}:${i} ${p?.param1} -> ${b.param1}`); }));
    throw new Error("unexpected 'keys changed' offer after reload: " + (await page.locator(".ry-offer").innerText()) + " " + diffs.join(", ") + " layers " + snap?.layers.length + "/" + now.layers.length);
  }
});

/* combos */
await step("combo: create A+S(+D, then remove D) = 4 using picker tiles", async () => {
  await tab("콤보");
  await page.getByRole("button", { name: "새 콤보" }).click();
  const item = page.locator(".ry-item.is-open");
  await item.getByTitle("위치 29", { exact: true }).click();
  await item.getByTitle("위치 30", { exact: true }).click();
  await item.getByTitle("위치 31", { exact: true }).click();
  await item.getByRole("button", { name: "D 빼기" }).click();
  assert.equal(await item.locator(".ry-combo-chip").count(), 2);
  await item.getByRole("tab", { name: "문자·숫자" }).click();
  await item.locator(".ry-fb-tile", { hasText: /^4$/ }).click();
  await saveBehaviors();
  const f = await flash();
  const c = f.combos.find((x) => x.keyPositions.length === 2 && x.keyPositions.includes(29) && x.keyPositions.includes(30));
  assert.ok(c, "combo stored with A+S");
  assert.equal(usage(c.behavior.param1), 0x21, "stored action is 4");
  await page.screenshot({ path: `${output}/03-combo.png`, fullPage: true });
});

await step("combo: try-it lab — press A and S together on the real keyboard → 4", async () => {
  const lab = page.locator(".ry-item.is-open .ry-lab").first();
  await lab.scrollIntoViewIfNeeded();
  await page.keyboard.down("f"); await page.keyboard.down("j");
  await page.waitForTimeout(60);
  await page.keyboard.up("f"); await page.keyboard.up("j");
  await page.waitForFunction(() => document.querySelector(".ry-item.is-open .ry-lab-typed kbd")?.textContent === "4", null, { timeout: 3000 });
  assert.equal((await lab.locator(".ry-lab-result").innerText()).trim(), "4");
  // Too far apart → each key types itself
  await lab.getByRole("button", { name: "지우기" }).click();
  await page.keyboard.down("f"); await page.waitForTimeout(250); await page.keyboard.down("j");
  await page.keyboard.up("f"); await page.keyboard.up("j");
  await page.waitForFunction(() => [...document.querySelectorAll(".ry-item.is-open .ry-lab-typed kbd")].map((k) => k.textContent).join("") === "AS", null, { timeout: 3000 });
});

await step("combo: assign by pressing a key on the computer keyboard", async () => {
  const item = page.locator(".ry-item.is-open");
  await item.getByRole("button", { name: "키보드로 직접 누르기" }).click();
  await page.keyboard.press("Digit5");
  await item.locator(".ry-fb-cap", { hasText: /^5$/ }).waitFor({ timeout: 2000 });
  await saveBehaviors();
  const c = (await flash()).combos.find((x) => x.keyPositions.includes(29) && x.keyPositions.includes(30));
  assert.equal(usage(c.behavior.param1), 0x22, "stored action is 5");
});

/* macros */
await step("macro: type text macro and save", async () => {
  await tab("매크로");
  await page.getByRole("button", { name: "새 매크로" }).click();
  const item = page.locator(".ry-item.is-open");
  await item.getByPlaceholder("입력할 글자 (영문, 숫자, 기호)").last().fill("Hi! [ok]?");
  await saveBehaviors();
  const f = await flash();
  assert.equal(f.macros.length, 1, "macro stored");
  const taps = JSON.stringify(f.macros[0]).match(/"param1":\d+/g)?.map((x) => Number(x.split(":")[1])) ?? [];
  const SHIFT = 0x02000000;
  // H(shifted) i !(shift+1) space [ o k ] ?(shift+/)
  for (const v of [0x7000b | SHIFT, 0x7000c, 0x7001e | SHIFT, 0x7002c, 0x7002f, 0x70012, 0x7000e, 0x70030, 0x70038 | SHIFT])
    assert.ok(taps.includes(v), "macro contains 0x" + v.toString(16));
  await page.screenshot({ path: `${output}/04-macro.png`, fullPage: true });
});

/* tap dance */
await step("keymap: put the macro on Z from the 매크로·탭댄스 tab", async () => {
  await tab("키맵");
  await key(42).click();
  await page.getByRole("tab", { name: "매크로·탭댄스" }).click();
  await page.locator(".ry-via-key", { hasText: "Macro 1" }).first().click();
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers[0].bindings[42].behaviorId !== 1, null, { timeout: 3000 });
  assert.match(await key(42).innerText(), /Macro 1/);
});

await step("tap dance: new dance with 1× A, 2× B and save", async () => {
  await tab("탭댄스");
  const before = (await flash()).dances.length;
  await page.getByRole("button", { name: "새 탭댄스" }).click();
  const item = page.locator(".ry-item.is-open");
  const pickers = item.locator(".ry-fb");
  for (const [i, k] of [[0, "A"], [1, "B"]]) {
    await pickers.nth(i).getByRole("button", { name: "목록에서 고르기" }).click();
    await pickers.nth(i).getByRole("tab", { name: "문자·숫자" }).click();
    await pickers.nth(i).locator(".ry-fb-tile", { hasText: new RegExp(`^${k}$`) }).click();
  }
  await saveBehaviors();
  const f = await flash();
  assert.equal(f.dances.length, before + 1);
  const d = f.dances[f.dances.length - 1];
  assert.equal(usage(d.config.singleBinding.param1), 0x04);
  assert.equal(usage(d.config.doubleBinding.param1), 0x05);
});

await step("tap dance lab: double tap → second action", async () => {
  const lab = page.locator(".ry-item.is-open .ry-lab").first();
  await lab.scrollIntoViewIfNeeded();
  for (let i = 0; i < 2; i++) { await page.keyboard.down("f"); await page.waitForTimeout(40); await page.keyboard.up("f"); await page.waitForTimeout(40); }
  await page.waitForFunction(() => document.querySelector(".ry-item.is-open .ry-lab-typed kbd:last-child")?.textContent === "B", null, { timeout: 3000 });
  await page.keyboard.down("f"); await page.waitForTimeout(30); await page.keyboard.up("f");
  await page.waitForFunction(() => document.querySelector(".ry-item.is-open .ry-lab-typed kbd:last-child")?.textContent === "A", null, { timeout: 3000 });
});

/* hold-tap */
await step("hold-tap: change mt tapping term and save", async () => {
  await tab("Hold-Tap");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/05-settings.png`, fullPage: true });
  const term = page.locator("input[type=number]").first();
  await term.fill("240");
  await saveBehaviors();
  const f = await flash();
  assert.ok(f.holds.some((h) => h.tappingTermMs === 240), "a hold-tap term is 240");
});

await step("hold-tap: change flavor, lab explanation follows", async () => {
  const card = page.locator("article.ry-item").first();
  const before = JSON.stringify((await flash()).holds);
  await card.locator("select").first().selectOption("balanced");
  await card.locator("summary", { hasText: "시간 흐름으로 자세히 보기" }).click();
  await card.getByText("누르고 있는 동안 다른 키를 눌렀다 떼면 홀드", { exact: false }).first().waitFor({ timeout: 3000 });
  await saveBehaviors();
  assert.notEqual(JSON.stringify((await flash()).holds), before, "flavor stored");
  assert.ok((await flash()).holds.some((h) => h.flavor === 1), "balanced = 1");
});

await step("combo: delete", async () => {
  await tab("콤보");
  const live = async () => (await flash()).combos.filter((c) => c.enabled).length;
  const n = await live();
  await page.getByRole("button", { name: "Combo 2 삭제" }).click();
  await saveBehaviors();
  assert.equal(await live(), n - 1);
});

await step("behaviours survive power cycle", async () => {
  await power();
  const r = await ram(), f = await flash();
  assert.deepEqual(r.combos, f.combos); assert.deepEqual(r.macros, f.macros); assert.deepEqual(r.dances, f.dances);
});

/* Bluetooth */
const slot2Select = async () => { if ((await flash()).active !== 1) throw new Error("slot 2 should still be selected"); };
await step("bluetooth: rename, switch, remove", async () => {
  await tab("Bluetooth 기기");
  await page.getByText("맥북").first().waitFor({ timeout: 8000 });
  const slot = (n) => page.locator(".ry-card", { has: page.locator(":scope") }).and(page.getByLabel(`슬롯 ${n}`, { exact: true }));
  await slot(4).getByRole("button", { name: "이름 붙이기" }).click();
  await page.locator("form input[type=text]").fill("아이폰");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await slot(4).getByText("아이폰", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal((await flash()).slots[3].name, "아이폰", "name stored on keyboard");
  await slot(2).getByRole("button", { name: "이 슬롯으로 전환" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.active === 1, null, { timeout: 5000 });
  await slot(2).getByRole("button", { name: "등록 삭제" }).click();
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  await page.waitForFunction(() => !window.__ryongVirtual.flash.slots[1].bonded, null, { timeout: 5000 });
  const f2 = await flash();
  assert.equal(f2.slots[1].name, "", "removed slot forgets its name");
  assert.equal(f2.active, 1, "removing keeps the selected slot");
  assert.ok(f2.slots[0].bonded && f2.slots[3].bonded, "other pairings untouched");
  await page.screenshot({ path: `${output}/06-bluetooth.png`, fullPage: true });
});

await step("bluetooth: manual key layout for a slot", async () => {
  await page.getByLabel("슬롯 4 배치").selectOption({ label: "Windows 표준" });
  await page.waitForFunction(() => window.__ryongVirtual.flash.slots[3].override !== 0, null, { timeout: 3000 });
});

await step("bluetooth: pair a new Windows PC on the empty selected slot", async () => {
  await slot2Select();
  const panelBtn = page.getByRole("button", { name: "Windows", exact: true });
  if (!(await panelBtn.isVisible())) await page.locator(".ry-virtual button").first().click();
  await panelBtn.click();
  await page.getByRole("button", { name: "키보드에서 다시 읽기" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.slots[1].bonded, null, { timeout: 3000 });
  await page.getByLabel("슬롯 2", { exact: true }).getByText("연결됨").waitFor({ timeout: 5000 });
  await page.getByLabel("슬롯 1", { exact: true }).getByText("등록됨 · 연결 안 됨").waitFor({ timeout: 5000 });
});

await step("no page errors (desktop)", async () => assert.deepEqual(errors, []));
await ctx.close();

/* ---------------- phone ---------------- */
ctx = await open({ width: 390, height: 844 }, { fresh: true });
await step("phone: connect, edit a key with touch, no sideways scroll", async () => {
  await connect();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  await page.screenshot({ path: `${output}/07-phone.png` });
  await key(15).tap();
  await page.locator(".ry-via-key", { hasText: /^Esc$/ }).first().tap();
  await page.locator("button:has([aria-label=Save])").tap();
  await page.waitForFunction(() => (window.__ryongVirtual.flash.layers[0].bindings[15].param1 & 0xffff) === 0x29, null, { timeout: 5000 });
  await page.screenshot({ path: `${output}/08-phone-edit.png` });
  for (const name of ["Undo", "Redo", "Save", "Discard"]) {
    const r = await page.locator(`button:has([aria-label=${name}])`).boundingBox();
    assert.ok(r && r.x >= 0 && r.x + r.width <= 390, `${name} button fully on screen`);
  }
  assert.equal(await page.evaluate(() => scrollX), 0, "page not scrolled sideways");
  for (const name of ["콤보", "매크로", "탭댄스", "Hold-Tap", "Bluetooth 기기"]) {
    await tab(name);
    await page.waitForTimeout(400);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(o <= 1, `${name}: horizontal overflow ${o}px`);
  }
});
await step("no page errors (phone)", async () => assert.deepEqual(errors, []));
await ctx.close();

await browser.close(); server.close();
const failed = results.filter((r) => !r.ok);
await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
