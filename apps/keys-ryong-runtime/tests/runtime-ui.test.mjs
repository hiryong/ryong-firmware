import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.RYONG_PLAYWRIGHT);
const root = path.resolve("dist-runtime");
const output = path.resolve("ui-verification");
await fs.mkdir(output, { recursive: true });
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/me")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ enabled: false, app: null, user: null, repos: [] }));
  }
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!filename.startsWith(root + path.sep)) throw new Error("invalid path");
    const bytes = await fs.readFile(filename);
    res.setHeader("Content-Type", mime[path.extname(filename)] || "application/octet-stream");
    res.end(bytes);
  } catch { res.statusCode = 404; res.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.RYONG_CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
await context.addInitScript(() => localStorage.setItem("ryong.lang", "ko"));
const page = await context.newPage();
const errors = []; const mutations = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", async route => {
  const req = route.request(); const url = new URL(req.url());
  if (!["GET", "HEAD"].includes(req.method())) mutations.push({ method: req.method(), url: req.url() });
  if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") return route.abort();
  return route.continue();
});
try {
  const url = "http://127.0.0.1:" + server.address().port + "/?runtime=1";
  await page.goto(url);
  await page.getByRole("button", { name: "콤보", exact: true }).click();
  if (await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).isVisible()) await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).click();
  await page.locator(".ry-item-head").first().click();
  await page.locator(".ry-item.is-open input[type=number]").fill("65");
  assert.equal(await page.locator("dialog[open][aria-label='Runtime development']").count(), 0);
  await page.getByRole("button", {name:"키맵",exact:true}).click();
  await page.getByRole("img", {name:"60% 키보드 배열 미리보기",exact:true}).waitFor();
  await page.getByRole("button", {name:/^매크로/}).click();
  await page.getByRole("button", {name:/^콤보/}).click();
  assert.equal(await page.locator(".ry-item.is-open input[type=number]").inputValue(),"65");

  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  await page.locator(".ry-workspace").evaluate(element => element.scrollTo(0, 0));
  await page.screenshot({ path: output + "/combos.png", fullPage: true });
  await page.getByRole("button", { name: /^매크로/ }).click();
  await page.getByRole("button", { name: "새 매크로", exact: true }).click();
  await page.locator(".ry-item.is-open input[type=text]").first().fill("Hello");
  await page.getByPlaceholder("입력할 글자 (영문, 숫자, 기호)").fill("Hi");
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  // The card being edited stays open after saving.
  assert.equal(await page.locator(".ry-item.is-open").count(), 1);
  await page.locator(".ry-workspace").evaluate(element => element.scrollTo(0, 0));
  await page.screenshot({ path: output + "/macros.png", fullPage: true });
  await page.locator(".ry-item.is-open input[type=text]").first().fill("Hello renamed");
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "콤보", exact: true }).click();
  if (await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).isVisible()) await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).click();
  await page.locator(".ry-item-head").first().click();
  assert.equal(await page.locator(".ry-item.is-open input[type=number]").inputValue(), "65");
  await page.getByRole("button", { name: /^매크로/ }).click();
  await page.getByRole("button", { name: /Hello renamed/ }).first().waitFor();
  await page.locator(".ry-item").first().getByRole("button", { name: /삭제$/ }).click();
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  assert.equal(await page.locator(".ry-item").count(), 0);
  await page.getByRole("button", {name:/^탭댄스/}).click();
  await page.getByRole("button", {name:"새 탭댄스",exact:true}).click();
  await page.locator(".ry-item.is-open input[type=text]").first().fill("Double test");
  await page.locator(".ry-item.is-open input[type=number]").fill("250");
  // Friendly picker: open the list, pick the letter tile.
  const dancePickers=page.locator(".ry-item.is-open .ry-fb");
  for (const [i,k] of [[0,"A"],[1,"B"]]) {
    await dancePickers.nth(i).getByRole("button",{name:"목록에서 고르기"}).click();
    await dancePickers.nth(i).getByRole("tab",{name:"문자·숫자"}).click();
    await dancePickers.nth(i).locator(".ry-fb-tile",{hasText:new RegExp(`^${k}$`)}).click();
  }
  await page.getByRole("button", {name:"미리보기 저장",exact:true}).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.",{exact:true}).waitFor();
  await page.getByRole("button", {name:/^탭·홀드/}).click();
  const modtap=page.locator(".ry-taphold");
  await page.getByRole("button",{name:"직접",exact:true}).click();
  await modtap.locator("input[type=number]").first().fill("285");
  await page.getByRole("radio",{name:/균형/}).check();
  await page.getByRole("button", {name:"미리보기 저장",exact:true}).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.",{exact:true}).waitFor();
  const downloadEvent=page.waitForEvent("download");
  await page.getByRole("button",{name:"동적 설정 백업",exact:true}).click();
  const download=await downloadEvent;
  const backup=await fs.readFile(await download.path(),"utf8");
  assert.equal(JSON.parse(backup).doc.tapDances[0].term,250);
  await page.reload();
  await page.getByRole("button", { name: "콤보", exact: true }).click();
  if (await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).isVisible()) await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).click();
  await page.getByRole("button",{name:/^탭·홀드/}).click();
  assert.equal(await modtap.locator("input[type=number]").first().inputValue(),"285");
  await page.getByLabel("동적 설정 백업 불러오기",{exact:true}).setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(backup)});
  await page.getByRole("button",{name:/^탭댄스/}).click();
  await page.getByRole("button",{name:/Double test/}).first().waitFor();
  await page.locator(".ry-workspace").evaluate(element=>element.scrollTo(0,0));
  await page.screenshot({path:output+"/advanced.png",fullPage:true});
  // Unsaved edits survive navigation, reload and explicit review-only draft recovery.
  await page.getByRole("button",{name:/^탭·홀드/}).click();
  await modtap.locator("input[type=number]").first().fill("299");
  await page.reload();
  await page.getByRole("button",{name:"콤보",exact:true}).click();
  await page.getByRole("button",{name:"연결 없이 미리보기",exact:true}).click();
  await page.getByRole("button",{name:"편집 내용 복원",exact:true}).click();
  await page.getByRole("button",{name:/^탭·홀드/}).click();
  assert.equal(await modtap.locator("input[type=number]").first().inputValue(),"299");
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem("ryong-runtime-preview-v1"))).advanced.holds[0].tappingTermMs,285);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({path:output+"/mobile-workspace.png",fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  const offline = path.resolve("offline-preview/Keys-Ryong-Runtime-Preview.html");
  const offlineHtml = await fs.readFile(offline, "utf8");
  assert.ok(offlineHtml.length > 500000, "standalone app bundle must be embedded");
  assert.ok(!/<script[^>]*src=/.test(offlineHtml));
  const offlinePage = await context.newPage();
  offlinePage.on("pageerror", error => errors.push(error.message));
  await offlinePage.goto(pathToFileURL(offline).href);
  await offlinePage.getByRole("button", {name:"콤보",exact:true}).click();
  await offlinePage.locator(".ry-item-head").first().waitFor();
  await offlinePage.getByText("· 미리보기 · 실제 기기는 변경하지 않음", { exact: true }).waitFor();
  await offlinePage.screenshot({ path: output + "/offline-preview.png", fullPage: true });
  await offlinePage.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  await fs.writeFile(output + "/result.json", JSON.stringify({ passed: true,
    mode: "browser-only preview; no device attached", checks: ["original editor rendering", "combo edit/save/reload",
      "macro text edit/save/reload", "Tap Dance actions/save/reload", "Tap·Hold timing/save/reload", "dynamic backup download/import", "standalone file:// preview", "no JavaScript page errors", "zero HTTP mutations"] }, null, 2));
  console.log("PASS: original runtime editor browser preview, combo/macro saves and reload, zero remote mutations");
} catch (error) {
  await page.screenshot({ path: output + "/failure.png", fullPage: true });
  await fs.writeFile(output + "/failure.txt", String(error) + "\n" + errors.join("\n"));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}

