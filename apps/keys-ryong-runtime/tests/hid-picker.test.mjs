// Bluetooth (WebHID) keyboard choice in a real browser, with fake keyboards that never answer:
// several allowed keyboards get our list, and its choices wait until every name check has closed,
// so the real connection never overlaps a name check (the cause of slow or stuck loading on Windows).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const pw = await import(process.env.RYONG_PLAYWRIGHT ?? "playwright");
const root = path.resolve(process.env.RYONG_DIST ?? "dist-runtime");
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
const browser = await pw.chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const log = []; window.__hidLog = log;
    const mk = (id) => Object.assign(new EventTarget(), {
      id, opened: false, productName: "", collections: [{ usagePage: 0xff5a, usage: 1 }],
      async open() { if (this.opened) log.push("double-open " + id); this.opened = true; log.push("open " + id); },
      async close() { this.opened = false; log.push("close " + id); },
      async sendReport() { /* never answers */ },
    });
    const devs = [mk("A"), mk("B")];
    const hid = Object.assign(new EventTarget(), { getDevices: async () => devs, requestDevice: async () => { log.push("browser list"); return []; } });
    Object.defineProperty(navigator, "hid", { value: hid });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?runtime=1`);
  await page.evaluate(() => localStorage.setItem("ryong-lang", "ko")).catch(() => {});
  if (await page.getByRole("button", { name: /^(Connect keyboard|키보드 연결)$/ }).isVisible()) await page.getByRole("button", { name: /^(Connect keyboard|키보드 연결)$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^(블루투스|Bluetooth)$/ }).click();
  const dlg = page.locator("dialog.ry-kbpick");
  await dlg.waitFor();
  const first = dlg.locator(".ry-kbpick-item").first();
  assert.ok(await first.isDisabled(), "choices wait while names are checked");
  await page.waitForFunction(() => !document.querySelector("dialog.ry-kbpick .ry-kbpick-item")?.disabled, null, { timeout: 15000 });
  const names = await dlg.locator(".ry-kbpick-item").allTextContents();
  assert.equal(names.length, 2);
  await first.click();
  await page.waitForFunction(() => window.__hidLog.filter((l) => l === "open A").length >= 2, null, { timeout: 10000 });
  // the page says it is connecting instead of sitting still (the fake keyboard never answers)
  await page.locator(".ry-connecting").filter({ hasText: /첫 응답|first answer|여는 중|Opening/ }).waitFor({ timeout: 5000 });
  const log = await page.evaluate(() => window.__hidLog);
  assert.ok(!log.some((l) => l.startsWith("double-open")), "no overlapping opens: " + log.join(", "));
  const realOpen = log.lastIndexOf("open A");
  assert.ok(log.indexOf("close A") < realOpen && log.indexOf("close B") < realOpen, "name checks closed before the real connection: " + log.join(", "));
  assert.ok(!log.includes("browser list"));
  console.log("PASS: two allowed keyboards: our list, choices wait for the name checks (" + names.join(" / ") + "), the real connection opens only after they closed (" + log.join(", ") + ")");
} finally { await browser.close(); server.close(); }
