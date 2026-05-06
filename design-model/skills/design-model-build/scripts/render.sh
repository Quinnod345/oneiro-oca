#!/bin/bash
# render.sh — render an HTML file to a PNG screenshot via the
# design-model's Puppeteer-backed screenshot-capture utility.
#
# Usage: render.sh <html_path> <png_out_path>

set -euo pipefail

HTML_PATH="${1:?usage: render.sh <html_path> <png_out_path>}"
PNG_PATH="${2:?usage: render.sh <html_path> <png_out_path>}"

DESIGN_MODEL_DIR="/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/design-model"

# Resolve to absolute paths (Puppeteer needs them)
HTML_PATH="$(cd "$(dirname "$HTML_PATH")" && pwd)/$(basename "$HTML_PATH")"
PNG_DIR="$(dirname "$PNG_PATH")"
mkdir -p "$PNG_DIR"
PNG_PATH="$(cd "$PNG_DIR" && pwd)/$(basename "$PNG_PATH")"

cd "$DESIGN_MODEL_DIR"
node -e "
import('./screenshot-capture.js').then(async ({ capture, cleanup }) => {
  const fs = await import('fs');
  const html = fs.readFileSync('$HTML_PATH', 'utf-8');
  await capture(html, '$PNG_PATH');
  await cleanup();
  console.log('rendered: $PNG_PATH');
}).catch(e => { console.error(e); process.exit(1); });
"
