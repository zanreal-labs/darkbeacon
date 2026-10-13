#!/usr/bin/env bash
# Runs your own Darkbeacon on this machine (docker-compose.local.yml) and names it with portless.
#   tools/local.sh up      build the image, start it and register https://<name>.localhost
#   tools/local.sh down    stop it (data stays in the volumes)
#   tools/local.sh logs    follow the app's log
# The name defaults to `darkbeacon`; set DARKBEACON_LOCAL_NAME to use another.
set -euo pipefail
cd "$(dirname "$0")/.."

name="${DARKBEACON_LOCAL_NAME:-darkbeacon}"
compose=(docker compose -f docker-compose.local.yml)

case "${1:-up}" in
  up)
    if [[ ! -f .env.local ]]; then
      echo "Missing .env.local: copy .env.example, set PUBLIC_URL=https://${name}.localhost and your EVE app." >&2
      exit 1
    fi
    "${compose[@]}" up -d --build
    port="$("${compose[@]}" port app 3000 | cut -d: -f2)"
    for _ in $(seq 1 60); do
      curl -fs -o /dev/null "http://127.0.0.1:${port}/api/health" && break
      sleep 2
    done
    portless alias "$name" "$port"
    echo "Darkbeacon is up: https://${name}.localhost"
    ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs -f app ;;
  *)
    echo "usage: tools/local.sh up|down|logs" >&2
    exit 2
    ;;
esac
