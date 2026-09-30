#!/bin/sh
# Rebuilds the GitHub Pages demo data from scratch, in one command:
#   sh api/demo/rebuild.sh
# Fresh `cashflow_demo` database → every migration → invented household
# (seed.mjs) → a throwaway API, Vite server and headless Chrome → record
# (record.mjs) → web/public/demo/responses.json. Never touches `cashflow`.
set -e
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
cleanup() { kill $API_PID $WEB_PID $CHROME_PID 2>/dev/null || true; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

dropdb --if-exists cashflow_demo
createdb cashflow_demo
for f in db/*.sql; do psql -q -v ON_ERROR_STOP=1 -d cashflow_demo -f "$f" >/dev/null; done
DATABASE_URL=postgres://localhost/cashflow_demo node api/demo/seed.mjs

(cd api && PORT=4100 DATABASE_URL=postgres://localhost/cashflow_demo LOG_LEVEL=warn exec node src/index.js) > "$TMP/api.log" 2>&1 &
API_PID=$!
(cd web && API_URL=http://127.0.0.1:4100 exec npx vite --port 5180 --strictPort) > "$TMP/web.log" 2>&1 &
WEB_PID=$!
"$CHROME" --headless=new --remote-debugging-port=9334 --user-data-dir="$TMP/chrome" --no-first-run about:blank > /dev/null 2>&1 &
CHROME_PID=$!

for url in http://127.0.0.1:4100/api/people http://127.0.0.1:5180/ http://127.0.0.1:9334/json/version; do
  i=0; until curl -sf -o /dev/null "$url"; do i=$((i+1)); [ $i -gt 60 ] && { echo "timed out waiting for $url"; exit 1; }; sleep 0.5; done
done
DEMO_CDP=http://127.0.0.1:9334 node api/demo/record.mjs
