#!/usr/bin/env bash
# One load run against the production image, everything in containers on a private network with
# no way out (the fake ESI is the only ESI the app can reach). See docs/scaling.md.
#
#   tools/loadtest/run.sh                       # SQLite, the full scenario, results in ./loadtest-results
#   DB=postgres SCENARIO=soak DURATION_S=1800 OUT=/tmp/x tools/loadtest/run.sh
#
# Scenarios: full (tracking + WebSocket clients + REST at once), snapshot (snapshot timing on an
# idle instance), tracking (ESI polling alone), soak (full for DURATION_S; heap snapshots with
# PROFILE=1 HEAP_SNAPSHOT=1), cluster (two replicas with CLUSTER=postgres behind a proxy).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DB="${DB:-sqlite}"
IMAGE="${IMAGE:-darkbeacon:perf}"
SCENARIO="${SCENARIO:-full}"
DURATION_S="${DURATION_S:-120}"
OUT="${OUT:-$PWD/loadtest-results}/$(date +%Y%m%d-%H%M%S)-$DB-$SCENARIO"
P="${PREFIX:-dbk-perf}"
APP_CPUS="${APP_CPUS:-2}"
APP_MEM="${APP_MEM:-2g}"
LOAD_CPUS="${LOAD_CPUS:-3}"
PROFILE="${PROFILE:-0}"
K6_IMAGE="grafana/k6:1.3.0"
PG_IMAGE="postgres:17"
LOAD_IMAGE="darkbeacon-loadtest:local"
SECRET_KEY="loadtest-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
NET="$P-net"
mkdir -p "$OUT"
echo "results: $OUT"

cleanup() {
  [ "${KEEP:-0}" = 1 ] && return
  docker rm -f "$P-app" "$P-app2" "$P-proxy" "$P-esi" "$P-pg" >/dev/null 2>&1 || true
  docker volume rm "$P-data" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  [ -n "${SAMPLER:-}" ] && kill "$SAMPLER" 2>/dev/null || true
}
trap cleanup EXIT
cleanup

docker build -q -t "$LOAD_IMAGE" "$HERE" >/dev/null
docker network create --internal "$NET" >/dev/null
docker volume create "$P-data" >/dev/null
# Results are written by the containers' node user.
chmod 777 "$OUT"

on_net() { docker run --rm --network "$NET" "$@"; }

DB_ENV=()
if [ "$DB" = postgres ]; then
  docker run -d --name "$P-pg" --network "$NET" --network-alias pg --cpus 2 --memory 2g \
    -e POSTGRES_USER=darkbeacon -e POSTGRES_PASSWORD=darkbeacon -e POSTGRES_DB=darkbeacon \
    "$PG_IMAGE" -c max_connections=200 -c shared_buffers=256MB >/dev/null
  until docker exec "$P-pg" pg_isready -U darkbeacon -d darkbeacon >/dev/null 2>&1; do sleep 1; done
  sleep 2
  DB_ENV=(-e DATABASE_URL=postgres://darkbeacon:darkbeacon@pg:5432/darkbeacon)
fi

echo "seeding..."
on_net -v "$P-data:/data" -v "$HERE:/app/apps/server/loadtest:ro" -v "$OUT:/out" \
  -e SECRET_KEY="$SECRET_KEY" -e OUT=/out/fixture.json ${DB_ENV[@]+"${DB_ENV[@]}"} \
  -e ACCOUNTS -e MAPS -e SYSTEMS -e CONNECTIONS -e TRACKED -e ONLINE \
  --entrypoint node "$IMAGE" apps/server/loadtest/seed.mjs | tee "$OUT/seed.txt"

docker run -d --name "$P-esi" --network "$NET" --network-alias fake-esi --cpus 1 --memory 512m \
  -v "$OUT:/fixture:ro" -e FIXTURE=/fixture/fixture.json \
  -e JUMP_EVERY_S -e BURST_EVERY_S -e BURST_SIZE -e ERROR_RATE -e LATENCY_MS \
  "$LOAD_IMAGE" node fake-esi.mjs >/dev/null

PROFILE_ENV=()
if [ "$PROFILE" = 1 ]; then
  # The API server and the Next.js server it starts both preload the profiler.
  PROFILE_ENV=(-e "NODE_OPTIONS=--import /loadtest/profile.mjs" -e HEAP_SNAPSHOT)
fi
start_app() {
  local name="$1" alias="$2"
  docker run -d --name "$name" --network "$NET" --network-alias "$alias" \
    --cpus "$APP_CPUS" --memory "$APP_MEM" --stop-timeout 30 \
    -v "$P-data:/data" -v "$OUT:/out" -v "$HERE:/loadtest:ro" \
    -e SECRET_KEY="$SECRET_KEY" -e PUBLIC_URL=http://app:3000 -e ESI_BASE_URL=http://fake-esi:8080 -e TELEMETRY=off \
    -e CLUSTER ${DB_ENV[@]+"${DB_ENV[@]}"} ${PROFILE_ENV[@]+"${PROFILE_ENV[@]}"} \
    "$IMAGE" >/dev/null
}
wait_healthy() {
  on_net "$LOAD_IMAGE" node -e "
    const until = Date.now() + 120000;
    (async () => { for (;;) {
      try { if ((await fetch('$1/api/health')).ok) process.exit(0); } catch {}
      if (Date.now() > until) process.exit(1);
      await new Promise((r) => setTimeout(r, 500));
    } })();"
}

if [ "$SCENARIO" = cluster ]; then
  [ "$DB" = postgres ] || { echo "cluster needs DB=postgres"; exit 1; }
  export CLUSTER=postgres
  start_app "$P-app" app1
  wait_healthy http://app1:3000
  start_app "$P-app2" app2
  wait_healthy http://app2:3000
  docker run -d --name "$P-proxy" --network "$NET" --network-alias app "$LOAD_IMAGE" \
    node proxy.mjs http://app1:3000 http://app2:3000 >/dev/null
  APPS=("$P-app" "$P-app2")
else
  start_app "$P-app" app
  APPS=("$P-app")
fi
wait_healthy http://app:3000
echo "app is up"

# Every 5 s: CPU and memory of the app containers, RSS of their node processes, SQLite's WAL size.
(
  echo "time,container,cpu,mem,rss_kb,wal_kb"
  while true; do
    for c in "${APPS[@]}"; do
      stats=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$c" 2>/dev/null | cut -d/ -f1)
      rss=$(docker exec "$c" sh -c 'cat /proc/[0-9]*/status 2>/dev/null; true' | awk '/^VmRSS/ {s+=$2} END {print s}')
      # SQLite's write-ahead log: it should stay small when checkpoints keep up.
      # (none on Postgres; the sampler runs under pipefail, so a missing file must not fail it)
      wal=$(docker exec "$c" sh -c '[ -f /data/app.db-wal ] && wc -c < /data/app.db-wal || echo 0' | awk '{print int($1/1024)}')
      echo "$(date +%s),$c,$stats,$rss,$wal"
    done
    sleep 5
  done
) >"$OUT/resources.csv" 2>/dev/null &
SAMPLER=$!

# Writes a CPU profile (and a heap snapshot with HEAP_SNAPSHOT=1) of every node process in the apps.
profile_now() {
  [ "$PROFILE" = 1 ] || return 0
  for c in "${APPS[@]}"; do
    # PID 1 is the API server; the others are the Next.js server it started.
    docker exec "$c" sh -c 'for p in /proc/[0-9]*; do
      case "$(head -c 4 "$p/cmdline" 2>/dev/null)" in node | next) kill -WINCH "${p#/proc/}" 2>/dev/null ;; esac
    done' || true
  done
}

run_load() {
  local seconds="$1"
  on_net --cpus "$LOAD_CPUS" -v "$OUT:/fixture" -e FIXTURE=/fixture/fixture.json -e OUT=/fixture/ws.json \
    -e DURATION_S="$seconds" -e CLIENTS -e CURSORS -e CURSOR_HZ -e EDITS_PER_S -e PROCS \
    "$LOAD_IMAGE" node ws-load.mjs >"$OUT/ws.log" 2>&1 &
  local ws=$!
  sleep 25 # the WebSocket clients connect first
  on_net --cpus 2 -v "$HERE:/scripts:ro" -v "$OUT:/out" -e BASE=http://app:3000 -e FIXTURE=/out/fixture.json \
    -e DURATION="$((seconds - 35))s" -e RATE="${RATE:-1}" -e OUT=/out/rest.json \
    "$K6_IMAGE" run --quiet /scripts/rest.k6.js >"$OUT/rest.txt" 2>&1 || true
  profile_now
  wait "$ws" || true
}

case "$SCENARIO" in
  snapshot)
    on_net -v "$OUT:/fixture:ro" -e FIXTURE=/fixture/fixture.json "$LOAD_IMAGE" node snapshot-bench.mjs \
      | tee "$OUT/snapshot.json"
    ;;
  full | cluster)
    profile_now # drops startup from the profile
    on_net -v "$OUT:/fixture:ro" -e FIXTURE=/fixture/fixture.json -e RUNS=20 "$LOAD_IMAGE" node snapshot-bench.mjs \
      >"$OUT/snapshot.json"
    run_load "$DURATION_S"
    on_net "$LOAD_IMAGE" node -e "fetch('http://fake-esi:8080/_stats').then(r=>r.text()).then(console.log)" >"$OUT/esi.json"
    ;;
  tracking)
    # ESI polling alone (no clients): what tracking costs, and how far the budget goes.
    on_net "$LOAD_IMAGE" node -e "fetch('http://fake-esi:8080/_reset',{method:'POST'})"
    sleep "$DURATION_S"
    on_net "$LOAD_IMAGE" node -e "fetch('http://fake-esi:8080/_stats').then(r=>r.text()).then(console.log)" \
      >"$OUT/esi.json"
    ;;
  soak)
    # A heap snapshot ten minutes in and one at the end show what grows.
    (sleep 600 && profile_now) &
    run_load "$DURATION_S"
    ;;
  *)
    echo "unknown scenario $SCENARIO"
    exit 1
    ;;
esac

docker logs "${APPS[0]}" >"$OUT/app.log" 2>&1 || true
kill "$SAMPLER" 2>/dev/null || true
SAMPLER=""
node_summary=$(awk -F, 'NR>1 && $5>0 {if ($5>m) m=$5} END {print m/1024}' "$OUT/resources.csv")
echo "peak RSS (MB): $node_summary" | tee "$OUT/rss.txt"
echo "done: $OUT"
