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
| `hotswap-kailh-mx.bin` | Kailh CPG151101S11 MX hot-swap socket | `SW_Hotswap_Kailh_MX.wrl` from [kiswitch/kiswitch](https://github.com/kiswitch/kiswitch) (MIT / CC BY-SA 4.0) | `--flip --dx 1.53 --dy -3.777` (its pin holes onto this footprint's) |
| `usb-c-kh-16p.bin` | Kinghelm KH-TYPE-C-16P-T (LCSC C709358) | the part's LCSC/EasyEDA STEP model (`modules.easyeda.com`, uuid 954b2a5828604707b62aef0fe6e7695f) | `--offset 0 -1.15 -1.1` (the board's own KiCad model offset) |

The converted hot-swap socket model stays under the source's licence (CC BY-SA 4.0 / MIT).
