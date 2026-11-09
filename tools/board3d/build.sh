#!/usr/bin/env bash
# Rebuild the board 3D assets: build.sh <package dir with .kicad_pcb, BOM_*.csv, gerber/> [name]
# Output: apps/keys-ryong-runtime/public/board3d/<name>/{board.json,top.webp,bottom.webp}
set -euo pipefail
pkg=$1; name=${2:-ryong60}
here=$(cd "$(dirname "$0")" && pwd); out=$here/../../apps/keys-ryong-runtime/public/board3d/$name
mkdir -p "$out"; tmp=$(mktemp -d)
node "$here/render_textures.mjs" "$pkg/gerber" "$tmp" 12
python3 -I -c "
from PIL import Image; import sys
for s in ('top','bottom'):
  Image.open(f'$tmp/{s}.png').save(f'$out/{s}.webp', 'WEBP', quality=88, method=6)
  Image.open(f'$tmp/{s}-bump.png').convert('L').save(f'$out/{s}-bump.webp', 'WEBP', quality=80, method=6)"
python3 -I "$here/build_board3d.py" --pcb "$pkg"/*.kicad_pcb --bom "$pkg"/BOM_*.csv --out "$out" --name "$name"
python3 "$here/fetch_models.py" --pcb "$pkg"/*.kicad_pcb --bom "$pkg"/BOM_*.csv --out "$out" --cache "${CACHE:-$tmp/models}"
