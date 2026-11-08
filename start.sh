#!/usr/bin/env bash
# Mission Control launcher (macOS / Linux). Same behaviour as start.cmd on Windows:
# checks BOTH ports and starts only the half that is down (running it twice is harmless),
# installs node_modules if missing, runs each server detached (logs in .logs/), opens http://localhost:4316.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
command -v node >/dev/null || { echo "Node.js not found — install the LTS from https://nodejs.org"; exit 1; }
port_up() { node -e 'const s=require("net").connect({port:+process.argv[1],host:process.argv[2]});s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),400)' "$1" 127.0.0.1 2>/dev/null \
  || node -e 'const s=require("net").connect({port:+process.argv[1],host:process.argv[2]});s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),400)' "$1" ::1 2>/dev/null; }
node scripts/card.mjs
APP="$(node -p 'require("./web/src/card.generated.json").appName')"
for d in . server web; do [ -d "$d/node_modules" ] || (echo "Installing dependencies in $d ..." && cd "$d" && npm install --no-fund --no-audit); done
mkdir -p .logs .satoru
if port_up 4317; then echo "$APP daemon already running on 4317"; else
  echo "Starting the $APP daemon (4317) ..."; (cd server && nohup npm start > "$ROOT/.logs/daemon.log" 2>&1 & echo $! > "$ROOT/.satoru/daemon.pid"); fi
if port_up 4316; then echo "$APP web already running on 4316"; else
  echo "Starting the $APP web app (4316) ..."; (cd web && nohup npm run dev > "$ROOT/.logs/web.log" 2>&1 & echo $! > "$ROOT/.satoru/web.pid"); fi
for i in $(seq 1 180); do port_up 4316 && port_up 4317 && break; sleep 0.5; done
port_up 4316 && port_up 4317 || { echo "Timed out — see .logs/daemon.log and .logs/web.log"; exit 1; }
echo "$APP is up: http://localhost:4316"
if [ -z "${NO_OPEN:-}" ]; then (command -v open >/dev/null && open http://localhost:4316) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4316 >/dev/null 2>&1) || true; fi
