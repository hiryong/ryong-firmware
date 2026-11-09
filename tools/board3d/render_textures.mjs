// Board textures for the 3D view, from the manufacturing Gerbers (what the factory makes):
//   top.png / bottom.png   colour: ivory-white solder mask with the copper showing faintly through it,
//                          black silkscreen, HASL (silver) pads; holes transparent
//   top-bump.png / ...     height for a bump map: copper (traces, pads) and silkscreen stand up from the board
//   npm i pcb-stackup@4.2.8 playwright   (Playwright's Chromium rasterises the SVG)
//   node render_textures.mjs <gerber dir> <out dir> [px per mm = 12]
import fs from "node:fs"; import path from "node:path";
import pcbStackup from "pcb-stackup";
const [dir, out, ppm = "12"] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /\.(gt[olsp]|gb[olsp]|gtl|gbl|gm1|gko|drl)$/i.test(f) && !/map|job/i.test(f));
const read = () => files.map((f) => ({ filename: f, gerber: fs.createReadStream(path.join(dir, f)) }));
const looks = {
  "": { fr4: "#c8c4b4", cu: "#bcb69f", cf: "#d4d4d0", sm: "rgba(233,233,229,0.9)", ss: "#161616", sp: "#a9a9a9", out: "#000000" },
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
    await page.setContent(`<html><body style="margin:0;background:${suffix ? "#000" : "transparent"}">${svg}</body></html>`);
    await page.screenshot({ path: path.join(out, `${side}${suffix}.png`), omitBackground: !suffix, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log(side + suffix, W, "x", H);
  }
}
await browser.close();
