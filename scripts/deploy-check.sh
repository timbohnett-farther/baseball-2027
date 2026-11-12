#!/usr/bin/env bash
# Deploy check: wait until production serves the pushed commit with every migration applied.
# Usage: scripts/deploy-check.sh [host] [sha]   (defaults: baseball-2027-production.up.railway.app, HEAD)
set -u
HOST="${1:-baseball-2027-production.up.railway.app}"
SHA="${2:-$(git rev-parse --short=7 HEAD)}"
WANT=$(grep -c '"tag"' "$(dirname "$0")/../apps/server/drizzle/meta/_journal.json")
for i in $(seq 1 40); do
  body=$(curl -s --max-time 10 "https://$HOST/health" || true)
  ver=$(printf '%s' "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  mig=$(printf '%s' "$body" | sed -n 's/.*"migrations":\([0-9]*\).*/\1/p')
  db=$(printf '%s' "$body" | sed -n 's/.*"database":"\([^"]*\)".*/\1/p')
  if [ "$ver" = "$SHA" ]; then
    if [ "$db" = "connected" ] && [ "${mig:-0}" -ge "$WANT" ]; then
      echo "OK $HOST serves $SHA, db $db, migrations $mig/$WANT"; exit 0
    fi
    echo "FAIL $HOST serves $SHA but db=$db migrations=${mig:-?}/$WANT"; exit 1
  fi
  echo "waiting ($i): $HOST on ${ver:-?}, want $SHA"; sleep 15
done
echo "TIMEOUT: $HOST never served $SHA"; exit 2
