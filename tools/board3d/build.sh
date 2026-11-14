#!/usr/bin/env bash
# Rebuild the board 3D assets: build.sh <package dir with .kicad_pcb, BOM_*.csv, gerber/> [name]
# Output: apps/keys-ryong-runtime/public/board3d/<name>/{board.json,top.webp,bottom.webp}
set -euo pipefail
pkg=$1; name=${2:-ryong60}
here=$(cd "$(dirname "$0")" && pwd); out=$here/../../apps/keys-ryong-runtime/public/board3d/$name
mkdir -p "$out"; tmp=$(mktemp -d)
# vias are plugged and covered (the board's order: Via Covering = Plugged): their drill sizes, from the design
vias=$(python3 -I -c "
import re,glob; s=open(glob.glob('$pkg/*.kicad_pcb')[0]).read()
print(','.join(sorted(set(re.findall(r'\(via[^()]*\(at [^)]*\)\s*\(size [\d.]+\)\s*\(drill ([\d.]+)\)', s)))))")
node "$here/render_textures.mjs" "$pkg/gerber" "$tmp" 12 "$vias"
python3 -I -c "
from PIL import Image; import sys
for s in ('top','bottom'):
  Image.open(f'$tmp/{s}-bump.png').convert('L').save(f'$out/{s}-bump.webp', 'WEBP', quality=80, method=6)"
python3 -I "$here/build_board3d.py" --pcb "$pkg"/*.kicad_pcb --bom "$pkg"/BOM_*.csv --out "$out" --name "$name"
python3 -I "$here/solder.py" "$tmp" "$out/board.json" "$out"  # colour textures: solder on fitted parts' pads, bare gold elsewhere
python3 "$here/fetch_models.py" --pcb "$pkg"/*.kicad_pcb --bom "$pkg"/BOM_*.csv --out "$out" --cache "${CACHE:-$tmp/models}"
python3 -I "$here/hash_assets.py" "$out"  # content-hashed names: cached for good by the site
