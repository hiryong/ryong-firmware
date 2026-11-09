// The maintenance page's board in 3D: opens from the footer, loads the board, and a part answers
// to hover (highlight + name) and click (what the part is). Software WebGL (SwiftShader) in CI.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const pw = await import(process.env.RYONG_PLAYWRIGHT ?? "playwright");
const root = path.resolve(process.env.RYONG_DIST ?? "dist-runtime");
const output = path.resolve("ui-verification/board3d");
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
const browser = await pw.chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"], ...(process.env.RYONG_CHROMIUM ? { executablePath: process.env.RYONG_CHROMIUM } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem("ryong.lang", "ko"));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?runtime=1`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await page.getByRole("button", { name: "유지보수" }).click();
  await page.locator(".ry-b3-stage canvas").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /^저항 26/ }).waitFor();
  await page.waitForTimeout(3000);
  for (const ref of ["U2", "R10"]) {
    const at = await page.evaluate((ref) => {
      const el = document.querySelector(".ry-b3-stage"), { camera, groups } = el.__three, r = el.getBoundingClientRect();
      for (const [p, g] of groups) if (p.ref === ref) { const v = g.getWorldPosition(g.position.clone()).project(camera); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; }
    }, ref);
    if (ref === "R10") { // a 1 mm part: zoom in on it first
      await page.evaluate(() => { const { camera, controls, groups } = document.querySelector(".ry-b3-stage").__three; const g = [...groups].find(([p]) => p.ref === "R10")[1]; controls.target.copy(g.position); camera.position.copy(g.position).add({ x: 0, y: 40, z: 25 }); controls.update(); });
      await page.waitForTimeout(800);
      const r = await page.locator(".ry-b3-stage").boundingBox();
      Object.assign(at, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
    }
    await page.mouse.move(at.x, at.y);
    await page.locator(".ry-b3-tip", { hasText: ref }).waitFor({ timeout: 5000 });
    await page.mouse.down(); await page.mouse.up();
    await page.locator(".ry-b3-info h3", { hasText: ref }).waitFor({ timeout: 5000 });
  }
  assert.match(await page.locator(".ry-b3-info").innerText(), /C25905/); // R10's LCSC number
  await page.screenshot({ path: path.join(output, "board3d.png") });
  assert.deepEqual(errors, []);
  console.log("ok   board 3D: loads, hover highlights, click shows the part");
} finally {
  await browser.close(); server.close();
}
