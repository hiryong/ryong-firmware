#!/usr/bin/env bash
set -euo pipefail
dest="${1:?isolated destination required}"
if [ -e "$dest" ]; then echo "Destination must not exist" >&2; exit 1; fi
git init "$dest"
git -C "$dest" remote add origin https://github.com/cormoran/zmk-studio-ts-client.git
git -C "$dest" fetch --depth 1 origin 3a759c4bd259d8d8f7c3783a9fa90a3048adfc47
git -C "$dest" checkout --detach FETCH_HEAD
test "$(git -C "$dest" rev-parse HEAD)" = 3a759c4bd259d8d8f7c3783a9fa90a3048adfc47
git -C "$dest" submodule update --init --recursive
(
  cd "$dest"
  npm ci --ignore-scripts
  npm run generate
  npm run build
)
