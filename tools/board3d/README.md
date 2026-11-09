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

`fetch_models.py` gives every assembled part except the resistors its real 3D model, placed the way
the board's KiCad file places it (footprint origin, model offset and rotation):

- parts whose model is `EASYEDA_MODELS/*.step`, and parts with no model in the design: the part's own
  LCSC/EasyEDA STEP, fetched by its LCSC number. EasyEDA's z offset is not used (its models sit on
  z = 0; chips modelled centred on z = 0 are seated), and the LCEDA logo it cuts into each model is
  filled in the colour around it.
- parts with a KiCad library model: KiCad's own STEP from kicad-packages3D.

Each model becomes `m-*.bin` (`convert_model.py`), listed with its parts in `models.json`. Per-model
fixes (the purple socket plastic from the LCSC photo, the module's tin-plated shield) are in `FIXES`.

    python3 fetch_models.py --pcb board.kicad_pcb --bom BOM.csv --out <board3d dir> --cache <dir>
