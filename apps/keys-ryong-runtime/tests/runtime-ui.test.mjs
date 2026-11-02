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
const browser = await chromium.launch({ headless: true });
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
  await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).click();
  await page.locator(".ry-item-head").first().click();
  await page.locator(".ry-item.is-open input[type=number]").fill("65");
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  await page.locator("dialog[open] .ry-hub-body").evaluate(element => element.scrollTo(0, 0));
  await page.screenshot({ path: output + "/combos.png", fullPage: true });
  await page.getByRole("button", { name: /^매크로/ }).click();
  await page.getByRole("button", { name: "새 매크로", exact: true }).click();
  await page.locator(".ry-item.is-open input[type=text]").first().fill("Hello");
  await page.getByPlaceholder("입력할 글자 (영문, 숫자, 기호)").fill("Hi");
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  await page.locator(".ry-item-head").first().click();
  await page.locator("dialog[open] .ry-hub-body").evaluate(element => element.scrollTo(0, 0));
  await page.screenshot({ path: output + "/macros.png", fullPage: true });
  await page.locator(".ry-item.is-open input[type=text]").first().fill("Hello renamed");
  await page.getByRole("button", { name: "미리보기 저장", exact: true }).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "연결 없이 미리보기", exact: true }).click();
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
  const danceKeys=page.locator(".ry-item.is-open").getByRole("combobox",{name:"키",exact:true});
  await danceKeys.nth(0).fill("A");await danceKeys.nth(0).press("Enter");
  await danceKeys.nth(1).fill("B");await danceKeys.nth(1).press("Enter");
  await page.getByRole("button", {name:"미리보기 저장",exact:true}).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.",{exact:true}).waitFor();
  await page.getByRole("button", {name:/^설정/}).click();
  const modtap=page.locator(".ry-item").filter({has:page.getByText("Mod-Tap",{exact:true})});
  await modtap.locator("input[type=number]").first().fill("285");
  await modtap.locator("select").selectOption("balanced");
  await page.getByRole("button", {name:"미리보기 저장",exact:true}).click();
  await page.getByText("미리보기를 이 브라우저에 저장했습니다.",{exact:true}).waitFor();
  const downloadEvent=page.waitForEvent("download");
  await page.getByRole("button",{name:"동적 설정 백업",exact:true}).click();
  const download=await downloadEvent;
  const backup=await fs.readFile(await download.path(),"utf8");
  assert.equal(JSON.parse(backup).doc.tapDances[0].term,250);
  await page.reload();
  await page.getByRole("button",{name:"연결 없이 미리보기",exact:true}).click();
  await page.getByRole("button",{name:/^설정/}).click();
  assert.equal(await modtap.locator("input[type=number]").first().inputValue(),"285");
  await page.getByLabel("동적 설정 백업 불러오기",{exact:true}).setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(backup)});
  await page.getByRole("button",{name:/^탭댄스/}).click();
  await page.getByRole("button",{name:/Double test/}).first().waitFor();
  await page.locator("dialog[open] .ry-hub-body").evaluate(element=>element.scrollTo(0,0));
  await page.screenshot({path:output+"/advanced.png",fullPage:true});
  const offline = path.resolve("offline-preview/Keys-Ryong-Runtime-Preview.html");
  const offlineHtml = await fs.readFile(offline, "utf8");
  assert.ok(offlineHtml.length > 500000, "standalone app bundle must be embedded");
  assert.ok(!/<script[^>]*src=/.test(offlineHtml));
  const offlinePage = await context.newPage();
  offlinePage.on("pageerror", error => errors.push(error.message));
  await offlinePage.goto(pathToFileURL(offline).href);
  await offlinePage.locator(".ry-item-head").first().waitFor();
  await offlinePage.getByText("미리보기 · 이 브라우저에만 저장하며 실제 키보드는 변경하지 않습니다.", { exact: true }).waitFor();
  await offlinePage.screenshot({ path: output + "/offline-preview.png", fullPage: true });
  await offlinePage.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  await fs.writeFile(output + "/result.json", JSON.stringify({ passed: true,
    mode: "browser-only preview; no device attached", checks: ["original editor rendering", "combo edit/save/reload",
      "macro text edit/save/reload", "Tap Dance actions/save/reload", "Hold-Tap timing/save/reload", "dynamic backup download/import", "standalone file:// preview", "no JavaScript page errors", "zero HTTP mutations"] }, null, 2));
  console.log("PASS: original runtime editor browser preview, combo/macro saves and reload, zero remote mutations");
} catch (error) {
  await page.screenshot({ path: output + "/failure.png", fullPage: true });
  await fs.writeFile(output + "/failure.txt", String(error) + "\n" + errors.join("\n"));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}

