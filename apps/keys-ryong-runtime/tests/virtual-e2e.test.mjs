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
const url = `http://127.0.0.1:${server.address().port}/?runtime=1&virtual=1`;
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
    if (fresh && !sessionStorage.getItem("e2e.started")) { localStorage.removeItem("ryong.virtualKeyboard.v4"); sessionStorage.setItem("e2e.started", "1"); }
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
  if (await btn.isVisible()) await page.locator(".ry-virtual button").first().click(); // fold the panel away again
}
const tab = (name) => page.getByRole("button", { name: new RegExp(`^${name}( ·)?$`) }).first().click();
const pickLetter = async (scope, k) => {
  const fb = scope.locator(".ry-kx-pick").first();
  await fb.getByRole("tab", { name: "문자·숫자" }).click();
  await fb.locator(".ry-fb-tile", { hasText: new RegExp(`^${k}$`) }).click();
};
const mapKey = async (scope, label) => {
  const keys = scope.locator(".ry-combokeys button");
  const i = await keys.evaluateAll((bs, l) => bs.findIndex((b) => b.textContent.trim() === l), label);
  assert.ok(i >= 0, label + " on the key map");
  await keys.nth(i).click();
  return i;
};

async function saveBehaviors() {
  await page.getByRole("button", { name: "키보드에 저장" }).click();
  await page.getByText("키보드에 저장했습니다.", { exact: false }).waitFor({ timeout: 10000 });
}

/* ---------------- desktop ---------------- */
let ctx = await open({ width: 1440, height: 900 }, { fresh: true });

await step("connect and unlock", async () => {
  await connect();
  const f = await flash();
  assert.equal(f.layers.length, 3); // base, raise, media (no os layer)
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
  await page.waitForFunction(() => (window.__ryongVirtual.ram.layers[0].bindings[15].param1 & 0xffff) === 0x29, null, { timeout: 3000 });
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
  await page.waitForFunction(() => window.__ryongVirtual.ram.layers.length === 4, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers.length === 4, null, { timeout: 3000 });
  const layerList = page.getByRole("listbox", { name: "Keymap Layer" });
  assert.equal(await layerList.getByRole("option").count(), 4);
  await layerList.getByRole("option").nth(3).click();
  await page.getByRole("button", { name: "레이어 삭제" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.ram.layers.length === 3, null, { timeout: 3000 });
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers.length === 3, null, { timeout: 3000 });
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
  await item.getByRole("button", { name: "콤보 동작 고르기" }).click(); // the box after "="
  await item.getByRole("tab", { name: "문자·숫자" }).click();
  await item.locator(".ry-fb-tile", { hasText: /^4$/ }).click();
  await saveBehaviors();
  const f = await flash();
  const c = f.combos.find((x) => x.keyPositions.length === 2 && x.keyPositions.includes(29) && x.keyPositions.includes(30));
  assert.ok(c, "combo stored with A+S");
  assert.equal(usage(c.behavior.param1), 0x21, "stored action is 4");
  await page.screenshot({ path: `${output}/03-combo.png`, fullPage: true });
});

await step("combo: try it with the real keys (what the keyboard sends) → 4", async () => {
  const lab = page.locator(".ry-item.is-open .ry-lab").first();
  await lab.scrollIntoViewIfNeeded();
  const box = lab.getByRole("textbox", { name: "테스트 칸" });
  await box.click();
  await page.keyboard.press("4"); // what the keyboard sends when A + S fire the combo
  await lab.getByText(/4이\(가\) 입력됐어요/).waitFor({ timeout: 3000 });
  await lab.getByRole("button", { name: "지우기" }).click();
  await page.keyboard.press("a"); // the keys one by one
  await lab.getByText(/하나씩 따로 입력됐어요/).waitFor({ timeout: 3000 });
  assert.equal(await page.locator(".ry-item.is-open .ry-lab-pads").count(), 0, "no simulated key pads for combos on a keyboard");
});

await step("combo: assign by pressing a key on the computer keyboard", async () => {
  const item = page.locator(".ry-item.is-open");
  await item.getByRole("button", { name: "콤보 동작 고르기" }).click();
  await item.getByRole("button", { name: "키보드로 직접 누르기" }).click();
  await page.keyboard.press("Digit5");
  await item.getByRole("button", { name: "콤보 동작 고르기" }).filter({ hasText: /^5$/ }).waitFor({ timeout: 2000 });
  await saveBehaviors();
  const c = (await flash()).combos.find((x) => x.keyPositions.includes(29) && x.keyPositions.includes(30));
  assert.equal(usage(c.behavior.param1), 0x22, "stored action is 5");
});

/* macros */
await step("firmware-built macros and unlock combo are listed; name-bound macro can't be renamed", async () => {
  await tab("콤보");
  await page.locator(".ry-item-head", { hasText: "Studio Unlock (Esc + Backspace)" }).waitFor({ timeout: 5000 });
  await tab("매크로");
  const head = page.locator(".ry-item-head", { hasText: "BT_PROFILE0" });
  await head.waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole("button", { name: "BT_PROFILE0 삭제" }).count(), 0, "no delete for a name-bound macro");
  await head.click();
  const item = page.locator(".ry-item.is-open");
  assert.equal(await item.locator("input[type=text]").first().isDisabled(), true, "name locked");
  await head.click(); // close again
});

await step("macro: type text macro and save", async () => {
  await tab("매크로");
  const before = (await flash()).macros.length;
  await page.getByRole("button", { name: "새 매크로" }).click();
  const item = page.locator(".ry-item.is-open");
  await item.getByPlaceholder("입력할 글자 (영문, 숫자, 기호)").last().fill("Hi! [ok]?");
  await saveBehaviors();
  const f = await flash();
  assert.equal(f.macros.length, before + 1, "macro stored");
  const created = f.macros.find((m) => !/^BT_PROFILE/.test(m.name));
  globalThis.createdMacro = created.name;
  const taps = JSON.stringify(created).match(/"param1":\d+/g)?.map((x) => Number(x.split(":")[1])) ?? [];
  const SHIFT = 0x02000000;
  // H(shifted) i !(shift+1) space [ o k ] ?(shift+/)
  for (const v of [0x7000b | SHIFT, 0x7000c, 0x7001e | SHIFT, 0x7002c, 0x7002f, 0x70012, 0x7000e, 0x70030, 0x70038 | SHIFT])
    assert.ok(taps.includes(v), "macro contains 0x" + v.toString(16));
  await page.screenshot({ path: `${output}/04-macro.png`, fullPage: true });
});

/* tap dance */
await step("keymap: put the macro on Z from the 매크로 tab, with a preview", async () => {
  await tab("키맵");
  await key(42).click();
  await page.getByRole("tab", { name: "매크로", exact: true }).click();
  const tile = page.locator(".ry-via-key", { hasText: globalThis.createdMacro }).first();
  await tile.hover();
  await page.locator(".ry-via-preview", { hasText: globalThis.createdMacro }).waitFor({ timeout: 3000 });
  await tile.click();
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.layers[0].bindings[42].behaviorId === 20, null, { timeout: 3000 });
  assert.ok((await key(42).innerText()).includes(globalThis.createdMacro));
});

await step("tap·hold tab: OS Adaptive hold (OS Mod-Tap) on J", async () => {
  await tab("탭·홀드");
  await page.getByRole("button", { name: "탭·홀드 추가" }).click();
  const ed = page.getByRole("region", { name: "새 탭·홀드" });
  await mapKey(ed, "J");
  await ed.getByRole("group", { name: "길게 누르면" }).getByRole("button", { name: "OS Alt/⌘", exact: true }).click();
  await ed.getByRole("button", { name: "키에 등록" }).click();
  await page.getByText("등록했어요: J", { exact: false }).waitFor({ timeout: 8000 });
  const b = (await flash()).layers[0].bindings[35];
  assert.ok(b.behaviorId === 31 && (b.param1 & 0xffff) === 0xe2 && (b.param2 & 0xffff) === 0x0d, JSON.stringify(b));
});

await step("keymap: backlight and underglow keys in the 조명 tab", async () => {
  await tab("키맵");
  await key(44).click(); // C
  await page.getByRole("tab", { name: "조명" }).click();
  await page.locator(".ry-via-key", { hasText: "백라이트 밝게" }).first().click();
  await page.locator("button:has([aria-label=Save])").click();
  await page.waitForFunction(() => { const b = window.__ryongVirtual.flash.layers[0].bindings[44]; return b.behaviorId === 29 && b.param1 === 3; }, null, { timeout: 3000 });
  assert.ok(await page.locator(".ry-via-key", { hasText: "언더글로우 켜기/끄기" }).count() > 0, "underglow tiles too");
});

await step("tap·hold tab: F hold = raise layer, G hold = Shift", async () => {
  await tab("탭·홀드");
  for (const [k, hold] of [["F", "raise 레이어"], ["G", "Shift"]]) {
    await page.getByRole("button", { name: "탭·홀드 추가" }).click();
    const ed = page.getByRole("region", { name: "새 탭·홀드" });
    await mapKey(ed, k);
    await ed.getByRole("group", { name: "길게 누르면" }).getByRole("button", { name: hold, exact: true }).click();
    await ed.getByRole("button", { name: "키에 등록" }).click();
    await page.getByText(`등록했어요: ${k}`, { exact: false }).waitFor({ timeout: 8000 });
  }
  const b = (await flash()).layers[0].bindings;
  assert.ok(b[32].behaviorId === 10 && b[32].param1 === 1 && b[33].behaviorId === 9, JSON.stringify([b[32], b[33]]));
});

await step("tap dance: add on W (1× stays W, 2× = B) and register", async () => {
  await tab("탭댄스");
  const before = (await flash()).dances.length;
  await page.getByRole("button", { name: "탭댄스 추가" }).click();
  const ed = page.getByRole("region", { name: "새 탭댄스" });
  const w = await mapKey(ed, "W");
  assert.equal((await ed.getByRole("button", { name: "1번 누르면 할 동작" }).innerText()).trim(), "W", "1× starts as the key itself");
  await ed.getByRole("button", { name: "2번 누르면 할 동작" }).click();
  await pickLetter(ed, "B");
  await page.screenshot({ path: `${output}/05-tapdance-editor.png`, fullPage: true });
  await ed.getByRole("button", { name: "키에 등록" }).click();
  await page.getByText("W 키에 등록했어요.", { exact: false }).waitFor({ timeout: 8000 });
  const f = await flash();
  assert.equal(f.dances.length, before + 1);
  const d = f.dances[f.dances.length - 1];
  assert.equal(usage(d.config.singleBinding.param1), 0x1a, "1× W");
  assert.equal(usage(d.config.doubleBinding.param1), 0x05, "2× B");
  assert.equal(f.layers[0].bindings[w].behaviorId, 21, "Runtime Tap Dance on W");
  globalThis.wPos = w;
  await page.getByRole("button", { name: "W 편집" }).waitFor();
  await page.screenshot({ path: `${output}/05-tapdance-list.png`, fullPage: true });
});

await step("tap dance: edit W, add 3× = C", async () => {
  await page.getByRole("button", { name: "W 편집" }).click();
  const ed = page.getByRole("region", { name: "탭댄스 편집" });
  await ed.getByRole("button", { name: "+ 3번 누름 추가" }).click();
  await ed.getByRole("button", { name: "3번 누르면 할 동작" }).click();
  await pickLetter(ed, "C");
  await ed.getByRole("button", { name: "키에 등록" }).click();
  await page.getByText("W 키에 등록했어요.", { exact: false }).waitFor({ timeout: 8000 });
  const d = (await flash()).dances.at(-1);
  assert.equal(usage(d.config.tripleBinding.param1), 0x06, "3× C");
});

/* hold-tap */
await step("tap·hold: add on H (tap H, hold Ctrl) and register", async () => {
  await tab("탭·홀드");
  await page.getByRole("button", { name: "탭·홀드 추가" }).click();
  const ed = page.getByRole("region", { name: "새 탭·홀드" });
  const h = await mapKey(ed, "H");
  assert.equal((await ed.getByRole("button", { name: "짧게 누르면 입력할 키" }).innerText()).trim(), "H");
  await ed.getByRole("group", { name: "길게 누르면" }).getByRole("button", { name: "Ctrl", exact: true }).click();
  await page.screenshot({ path: `${output}/06-taphold-editor.png`, fullPage: true });
  await ed.getByRole("button", { name: "키에 등록" }).click();
  await page.getByText("등록했어요: H", { exact: false }).waitFor({ timeout: 8000 });
  const b = (await flash()).layers[0].bindings[h];
  assert.equal(b.behaviorId, 9, "Mod-Tap");
  assert.equal(b.param1 & 0xffff, 0xe0, "hold = Ctrl");
  assert.equal(b.param2 & 0xffff, 0x0b, "tap = H");
  globalThis.hPos = h;
  await page.getByRole("button", { name: "H 편집" }).waitFor();
  await page.screenshot({ path: `${output}/06-taphold-list.png`, fullPage: true });
});

await step("tap·hold: hold time preset and decision, saved for every tap·hold", async () => {
  await page.getByRole("button", { name: /여유 있게/ }).click();
  await page.getByText("판정 시간을 280ms로 저장했어요.").waitFor({ timeout: 8000 });
  assert.ok((await flash()).holds.every((h) => h.tappingTermMs === 280), "280 ms");
  await page.getByText("누른 채 다른 키를 누르면 (고급)").click();
  await page.getByRole("radio", { name: /균형/ }).check();
  await page.getByText("저장했어요.", { exact: true }).waitFor({ timeout: 8000 });
  assert.ok((await flash()).holds.every((h) => h.flavor === 1), "balanced");
});

await step("tap·hold: remove H, the key types H again", async () => {
  await page.getByRole("button", { name: "H 지우기" }).click();
  await page.getByText("지웠어요.").waitFor({ timeout: 8000 });
  const b = (await flash()).layers[0].bindings[globalThis.hPos];
  assert.equal(b.behaviorId, 1, "Key Press");
  assert.equal(b.param1 & 0xffff, 0x0b);
});

await step("tap dance: remove W, the key types W again", async () => {
  await tab("탭댄스");
  const n = (await flash()).dances.length;
  await page.getByRole("button", { name: "W 지우기" }).click();
  await page.getByText("지웠어요.").waitFor({ timeout: 8000 });
  const f = await flash();
  assert.equal(f.dances.length, n - 1);
  assert.equal(f.layers[0].bindings[globalThis.wPos].behaviorId, 1);
  assert.equal(f.layers[0].bindings[globalThis.wPos].param1 & 0xffff, 0x1a);
});

await step("combo: delete", async () => {
  await tab("콤보");
  const live = async () => (await flash()).combos.filter((c) => c.enabled).length;
  const n = await live();
  await page.getByRole("button", { name: /^Combo \d+ 삭제$/ }).last().click();
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
  await page.locator(".ry-virtual button").first().click(); // fold the panel
  await page.getByRole("button", { name: "키보드에서 다시 읽기" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.slots[1].bonded, null, { timeout: 3000 });
  await page.getByLabel("슬롯 2", { exact: true }).getByText("연결됨").waitFor({ timeout: 5000 });
  await page.getByLabel("슬롯 1", { exact: true }).getByText("등록됨 · 연결 안 됨").waitFor({ timeout: 5000 });
});

await step("keys.ryong.com has no firmware menu (firmware lives in /admin)", async () => {
  assert.equal(await page.getByRole("button", { name: "펌웨어", exact: true }).count(), 0);
});

await step("keyboard settings: deep sleep off/on and minutes, saved on the keyboard", async () => {
  await tab("키보드 설정");
  const pane = page.locator("#ry-device-pane");
  await pane.getByRole("switch", { name: "깊은 절전" }).waitFor({ timeout: 8000 });
  assert.equal(await pane.getByRole("switch", { name: "깊은 절전" }).getAttribute("aria-checked"), "true");
  await pane.getByRole("button", { name: "10분" }).click();
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device?.settings.sleepMinutes === 10, null, { timeout: 5000 });
  await pane.getByRole("switch", { name: "깊은 절전" }).click();
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device?.settings.sleepEnabled === false, null, { timeout: 5000 });
  assert.equal(await pane.getByRole("button", { name: "10분" }).count(), 0, "minutes hidden while sleep is off");
  await page.screenshot({ path: `${output}/09-device-settings.png`, fullPage: true });
});

await step("keyboard settings: backlight use switch, brightness applies at once, USB-only follows the cable", async () => {
  const pane = page.locator("#ry-device-pane");
  const bl = pane.getByLabel("백라이트", { exact: true });
  assert.equal(await bl.getByRole("button", { name: /켜기|끄기/ }).count(), 0, "no 'right now' power button");
  await pane.getByRole("switch", { name: "백라이트 사용" }).click();
  await bl.getByRole("switch", { name: "백라이트 켤 때 켜기" }).click();
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device?.settings.backlight.use === true, null, { timeout: 5000 });
  await power(); // on at start → lit
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.blOn === true, null, { timeout: 5000 });
  await pane.getByRole("button", { name: "키보드에서 다시 읽기" }).click();
  const slider = bl.getByRole("slider", { name: "백라이트 밝기" });
  await slider.waitFor();
  await page.waitForTimeout(500); // the re-read finishes (it re-renders the pane and would take the focus)
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight"); // 40 → 70 in 5% steps
  // no Save press: the slider writes by itself once let go
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.settings.backlight.brightness === 70, null, { timeout: 5000 });
  await bl.getByRole("switch", { name: "백라이트: USB 연결 때만 켜기" }).click();
  assert.equal(await pane.getByRole("switch", { name: "언더글로우: USB 연결 때만 켜기" }).count(), 0, "underglow options hidden while it is off");
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.settings.backlight.usbOnly === true, null, { timeout: 5000 });
  const usb = page.getByRole("button", { name: /USB 케이블/ });
  if (!(await usb.isVisible())) await page.locator(".ry-virtual button").first().click();
  await usb.click(); // unplug
  assert.equal(await page.evaluate(() => window.__ryongVirtual.flash.device.blOn), false, "dark on battery");
  await usb.click(); // plug back
  assert.equal(await page.evaluate(() => window.__ryongVirtual.flash.device.blOn), true, "lit again on USB");
  await page.locator(".ry-virtual button").first().click();
  // feature off → dark
  await pane.getByRole("switch", { name: "백라이트 사용" }).click();
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.blOn === false && !window.__ryongVirtual.flash.device.settings.backlight.use, null, { timeout: 5000 });
});

await step("keyboard settings: underglow on at start survives a power cycle", async () => {
  const pane = page.locator("#ry-device-pane");
  await pane.getByRole("switch", { name: "RGB 언더글로우 사용" }).click();
  await pane.getByRole("switch", { name: "RGB 언더글로우 켤 때 켜기" }).click(); // lights start dark by default
  await pane.getByRole("switch", { name: "언더글로우: USB 연결 때만 켜기" }).click(); // off: also on battery
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => { const u = window.__ryongVirtual.flash.device.settings.underglow; return u.use && u.onAtStart && !u.usbOnly; }, null, { timeout: 5000 });
  await power();
  assert.equal(await page.evaluate(() => window.__ryongVirtual.flash.device.ugOn), true, "on at start");
  await pane.getByRole("button", { name: "키보드에서 다시 읽기" }).click();
  await pane.getByLabel("RGB 언더글로우", { exact: true }).getByText(/지금 켜져 있어요/).waitFor({ timeout: 5000 });
});

await step("keyboard settings: Bluetooth slot light on/off and brightness", async () => {
  const pane = page.locator("#ry-device-pane");
  const slider = pane.getByRole("slider", { name: "알림 밝기" });
  await slider.waitFor();
  await page.waitForTimeout(500); // the previous step's re-read finishes first
  await slider.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight"); // 1 → 5
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.settings.btIndicator?.brightness === 5, null, { timeout: 5000 });
  await pane.getByRole("switch", { name: "연결되면" }).click(); // off
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.settings.btIndicator?.hideConnected === true
    && window.__ryongVirtual.flash.device.settings.btIndicator?.hidePairing === false, null, { timeout: 5000 });
  await pane.getByRole("switch", { name: "Bluetooth 슬롯 알림 사용" }).click();
  await pane.getByRole("button", { name: "키보드에 저장" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.settings.btIndicator?.use === false, null, { timeout: 5000 });
  assert.equal(await pane.getByRole("slider", { name: "알림 밝기" }).count(), 0, "brightness hidden while off");
});

await step("keyboard settings: rename the keyboard", async () => {
  const pane = page.locator("#ry-device-pane");
  const box = pane.getByRole("textbox", { name: "키보드 이름" });
  await box.fill("민수 키보드");
  await pane.getByRole("button", { name: "이름 바꾸기" }).click();
  await page.waitForFunction(() => window.__ryongVirtual.flash.device.name === "민수 키보드", null, { timeout: 5000 });
  await box.fill("이름이아주아주긴키보드");
  assert.equal(await pane.getByRole("button", { name: "이름 바꾸기" }).isDisabled(), true, "over 16 bytes cannot be saved");
  await box.fill("민수 키보드");
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
  for (const name of ["콤보", "매크로", "탭댄스", "탭·홀드", "Bluetooth 기기"]) {
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
