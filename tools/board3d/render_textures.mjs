// Board textures for the 3D view, from the manufacturing Gerbers (what the factory makes):
// white solder mask, black silkscreen, HASL (silver) pads, holes transparent.
//   npm i pcb-stackup@4.2.8 playwright   (Playwright's Chromium rasterises the SVG)
//   node render_textures.mjs <gerber dir> <out dir> [px per mm = 12]
// Writes top.png / bottom.png (PNG with alpha); build.sh converts them to WebP.
import fs from "node:fs"; import path from "node:path";
import pcbStackup from "pcb-stackup";
const [dir, out, ppm = "12"] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /\.(gt[olsp]|gb[olsp]|gtl|gbl|gm1|gko|drl)$/i.test(f) && !/map|job/i.test(f));
const stack = await pcbStackup(files.map((f) => ({ filename: f, gerber: fs.createReadStream(path.join(dir, f)) })), {
  outlineGapFill: 0.05,
  color: { fr4: "#d9d2b8", cu: "#cfcfcf", cf: "#dcdcd8", sm: "rgba(246,246,242,0.94)", ss: "#121212", sp: "#b0b0b0", out: "#000000" },
});
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
for (const side of ["top", "bottom"]) {
  let svg = stack[side].svg;
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  const W = Math.round((Number(vb[3]) / 1000) * Number(ppm)), H = Math.round((Number(vb[4]) / 1000) * Number(ppm));
  svg = svg.replace(/<svg\b[^>]*>/, (t) => t.replace(/\swidth="[^"]*"/, ` width="${W}"`).replace(/\sheight="[^"]*"/, ` height="${H}"`));
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(out, `${side}.png`), omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
  await page.close();
  console.log(side, W, "x", H);
}
await browser.close();
