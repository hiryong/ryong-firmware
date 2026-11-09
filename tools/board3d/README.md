# board3d

Builds the assembled-board 3D view on keys.ryong.com (Maintenance → board in 3D).

    tools/board3d/build.sh <package dir> [name]

The package dir is a board release package: `*.kicad_pcb`, `BOM_*.csv`, `gerber/`.
Output goes to `apps/keys-ryong-runtime/public/board3d/<name>/`:

- `top.webp`, `bottom.webp`: board faces rendered from the Gerbers (pcb-stackup, white mask, black silk)
- `board.json`: outline, holes, and every BOM part (position, rotation, package size, role)

Only these derived files are committed; the design files themselves stay out of this public repo.
Needs `npm i pcb-stackup@4.2.8 playwright` and Python 3 with Pillow.

## Real part models

Most parts are drawn as simple shapes sized from the footprint. The parts that fill most of the
board's volume use real 3D models, converted with `convert_model.py` into `<name>.bin`:

| file | part | source | placement |
|---|---|---|---|
| `hotswap-cpg151101s11-16.bin` | HanElectricity CPG151101S11-16 (LCSC C41430893), the purple MX hot-swap socket on this board | the part's LCSC/EasyEDA STEP model (uuid 5c2d585f6c544fcf92e7ed163bda57d3) | `--drop "#000000" --recolor "#230092=#5a50b4" --cover 1.4 1.05 0.38 3.75 1.062 1.18 "#230092"` (the EasyEDA logo on its side covered; plastic colour from the LCSC photo) |
| `usb-c-kh-16p.bin` | Kinghelm KH-TYPE-C-16P-T (LCSC C709358) | the part's LCSC/EasyEDA STEP model (`modules.easyeda.com`, uuid 954b2a5828604707b62aef0fe6e7695f) | `--offset 0 -1.15 0` (the board's KiCad model offset in x/y; z 0 so it sits on the board — the EasyEDA z sinks it) |

Both are placed from the footprint origin (`origin` in board.json).
