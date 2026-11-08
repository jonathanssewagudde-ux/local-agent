#!/usr/bin/env bash
# Stops Mission Control: frees ports 4316 and 4317.
cd "$(dirname "$0")"
for f in .satoru/daemon.pid .satoru/web.pid; do
  if [ -f "$f" ]; then pid="$(cat "$f")"; pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; rm -f "$f"; fi
done
node -e '
const { execSync } = require("child_process");
for (const port of [4316, 4317]) {
  let pids = "";
  try { pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  if (!pids) try { pids = execSync(`fuser ${port}/tcp 2>/dev/null`).toString().trim(); } catch {}
  for (const p of pids.split(/\s+/).filter(Boolean)) try { process.kill(+p, "SIGTERM"); } catch {}
}'
sleep 1
busy=""
for p in 4316 4317; do node -e 'const s=require("net").connect(+process.argv[1],"127.0.0.1");s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1))' $p 2>/dev/null && busy="$busy $p"; done
if [ -z "$busy" ]; then echo "Stopped. Ports 4316 and 4317 are free."; else echo "Still in use:$busy"; exit 1; fi
