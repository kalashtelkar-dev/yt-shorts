#!/usr/bin/env sh
# Fails if a server secret name or live key prefix ends up in the client bundle (CLAUDE.md §10).
set -eu
dir=".next/static"
[ -d "$dir" ] || { echo "Run npm run build first ($dir missing)"; exit 1; }
if grep -rlE 'ENGINEX_API_KEY|ek_live|CASHFREE_SECRET_KEY|cfsk_ma_' "$dir"; then
  echo "Secret leaked into client bundle (files above)"
  exit 1
fi
echo "No secrets in $dir"
