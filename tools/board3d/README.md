# board3d

Builds the assembled-board 3D view on keys.ryong.com (Maintenance → board in 3D).

    tools/board3d/build.sh <package dir> [name]

The package dir is a board release package: `*.kicad_pcb`, `BOM_*.csv`, `gerber/`.
Output goes to `apps/keys-ryong-runtime/public/board3d/<name>/`:

- `top.webp`, `bottom.webp`: board faces rendered from the Gerbers (pcb-stackup, white mask, black silk)
- `board.json`: outline, holes, and every BOM part (position, rotation, package size, role)

Only these derived files are committed; the design files themselves stay out of this public repo.
Needs `npm i pcb-stackup@4.2.8 playwright` and Python 3 with Pillow.
