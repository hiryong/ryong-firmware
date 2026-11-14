// Board textures for the 3D view, from the manufacturing Gerbers (what the factory makes):
//   top.png / bottom.png   colour: ivory-white solder mask with the copper showing faintly through it,
//                          black silkscreen, ENIG (gold) pads with solder where paste goes; holes transparent,
//   top-bare.png / ...     the same without solder (all exposed copper gold): solder.py keeps solder only on the
//                          pads of parts the factory fits
//                          except plugged vias (covered by mask, as ordered: Via Covering = Plugged)
//   top-bump.png / ...     height for a bump map: copper (traces, pads) and silkscreen stand up from the board
//   npm i pcb-stackup@4.2.8 playwright   (Playwright's Chromium rasterises the SVG)
//   node render_textures.mjs <gerber dir> <out dir> [px per mm = 12] [plugged via drills, mm, e.g. 0.3,0.4]
import fs from "node:fs"; import path from "node:path";
import pcbStackup from "pcb-stackup";
const [dir, out, ppm = "12", plugged = ""] = process.argv.slice(2);
// plugged vias: their drill hits are left out, so the mask covers them as on the board
const pluggedD = plugged.split(",").filter(Boolean).map(Number);
function drillText(text) {
  if (!pluggedD.length) return text;
  const drop = new Set([...text.matchAll(/^(T\d+)C([\d.]+)/gm)].filter((m) => pluggedD.some((d) => Math.abs(Number(m[2]) - d) < 1e-3)).map((m) => m[1]));
  let skip = false;
  return text.split(/\r?\n/).filter((l) => {
    const t = /^(T\d+)$/.exec(l); if (t) { skip = drop.has(t[1]); return true; }
    return !(skip && /^[XY]/.test(l));
  }).join("\n");
}
const files = fs.readdirSync(dir).filter((f) => /\.(gt[olsp]|gb[olsp]|gtl|gbl|gm1|gko|drl)$/i.test(f) && !/map|job/i.test(f));
const read = () => files.map((f) => ({ filename: f, gerber: /\.drl$/i.test(f) ? drillText(fs.readFileSync(path.join(dir, f), "utf8")) : fs.createReadStream(path.join(dir, f)) }));
const looks = {
  "": { fr4: "#c8c4b4", cu: "#bcb69f", cf: "#d2b064", sm: "rgba(233,233,229,0.9)", ss: "#161616", sp: "#b4b4b0", out: "#000000" }, // cf: ENIG gold
  "-bare": { fr4: "#c8c4b4", cu: "#bcb69f", cf: "#d2b064", sm: "rgba(233,233,229,0.9)", ss: "#161616", sp: "#d2b064", out: "#000000" }, // no solder: for unpopulated pads (solder.py)
  "-bump": { fr4: "#000000", cu: "#c8c8c8", cf: "#ffffff", sm: "rgba(0,0,0,0)", ss: "#8a8a8a", sp: "#ffffff", out: "#000000" },
};
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
for (const [suffix, color] of Object.entries(looks)) {
  const stack = await pcbStackup(read(), { outlineGapFill: 0.05, color });
  for (const side of ["top", "bottom"]) {
    let svg = stack[side].svg;
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
    const W = Math.round((Number(vb[3]) / 1000) * Number(ppm)), H = Math.round((Number(vb[4]) / 1000) * Number(ppm));
    svg = svg.replace(/<svg\b[^>]*>/, (t) => t.replace(/\swidth="[^"]*"/, ` width="${W}"`).replace(/\sheight="[^"]*"/, ` height="${H}"`));
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const bump = suffix === "-bump";
    await page.setContent(`<html><body style="margin:0;background:${bump ? "#000" : "transparent"}">${svg}</body></html>`);
    await page.screenshot({ path: path.join(out, `${side}${suffix}.png`), omitBackground: !bump, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log(side + suffix, W, "x", H);
  }
}
await browser.close();
