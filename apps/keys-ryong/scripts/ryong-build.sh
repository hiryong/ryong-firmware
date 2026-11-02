#!/usr/bin/env bash
# keys.ryong.com build (Cloudflare Pages build command: bash scripts/ryong-build.sh, output: dist)
# The upstream build fetches ZMK Studio release info from the GitHub API for the /download page.
# Shared build servers sometimes hit GitHub's rate limit, so fall back to an empty file instead of failing.
set -euo pipefail
npm run generate-data || { mkdir -p src/data; echo '{"tag_name":"","assets":[]}' > src/data/release-data.json; }
npx tsc
npx vite build
