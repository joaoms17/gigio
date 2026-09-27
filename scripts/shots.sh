#!/usr/bin/env bash
# Build com Supabase fictício + screenshots de todas as páginas.
# Uso: scripts/shots.sh <pasta-destino>   (env opcional: THEMES, VIEWS, ONLY)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-shots}"
VITE_SUPABASE_URL=https://mockproj.supabase.co VITE_SUPABASE_ANON_KEY=mockanon npx vite build --logLevel error
node scripts/visual-shots.mjs "$OUT"
