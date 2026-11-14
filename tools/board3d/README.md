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

## Placement checks (geist rev1.0 S4)
- EasyEDA models are grouped per footprint *and* LCSC part, and each group gets its own quarter turn from
  that part's EasyEDA footprint pads (footprint variants such as `…-BL` / `…-TL` differ).
- EasyEDA's model origin is sometimes wrong (D2 was 1.3 mm off, the SOT-23 MOSFETs metres off), so parts
  that are symmetric about their pads (`CENTRED` kinds) are centred on their pads (`convert_model.py --centre`).
- A vendor model whose feet sit off its own footprint is moved with `--shift` in `FIXES` (MK-11C04 slide switch).
- The turns written to `<cache>/turns.json` were checked against the order CPL: board rotation + turn equals
  the CPL rotation for every EasyEDA-placed part.
- Model files are stored gzipped (the host does not compress `.bin`); the viewer unpacks them with
  `DecompressionStream`. The geist S4 set went from 3.97 MB to 2.68 MB in total.
- Models supplied by the board's owner go in `models/` and are listed in `GIVEN` (fetch_models.py): glTF
  binary in metres, y up, x across the part, z = KiCad y, centred on the part. They are copied as they are
  and the viewer loads them with GLTFLoader, keeping their materials and textures (the MDBT50Q-1MV2's
  marking is a texture).
- `hash_assets.py` (last step of build.sh) gives textures (`t-…`) and models (`m-…`) content-hashed names;
  `public/_headers` lets browsers keep those for good, so a second visit loads nothing but board.json and models.json.
- Makers' own STEP files that the owner downloads (e.g. Panasonic's `D2E.STEP` for the POSCAP 6TPE330MAP,
  C42–C46) go in `<cache>/given/` and are placed by `MAKER_STEP` (fetch_models.py). They are not committed
  here; only the converted mesh is. Without the file, the design's library model is used.
