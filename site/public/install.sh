#!/bin/sh
# Darkbeacon: installs (or updates) your own instance with Docker.
#
#   curl -fsSL https://darkbeacon.space/install.sh | sh
#
# It makes a folder (~/darkbeacon unless DARKBEACON_DIR says otherwise) with a compose.yaml and an
# .env, pulls ghcr.io/zanreal-labs/darkbeacon and starts it. Run it again to update: the .env is kept
# and only the image is pulled again. Nothing is installed outside that folder and Docker's volumes.
#
# Without a terminal (CI, provisioning) it takes its answers from the environment:
#   DARKBEACON_DIR       where the instance lives            (default: ~/darkbeacon)
#   DARKBEACON_VERSION   image tag: edge, sha-<commit>, X.Y.Z (default: edge)
#   DARKBEACON_PORT      port on this machine                (default: 3000)
#   PUBLIC_URL           the address people open             (default: http://localhost:<port>)
#   EVE_CLIENT_ID, EVE_CLIENT_SECRET   your EVE application  (can be added to .env later)
set -eu

IMAGE="ghcr.io/zanreal-labs/darkbeacon"
DIR="${DARKBEACON_DIR:-$HOME/darkbeacon}"
VERSION="${DARKBEACON_VERSION:-edge}"
PORT="${DARKBEACON_PORT:-3000}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'darkbeacon: %s\n' "$*" >&2
  exit 1
}

# Questions go to the terminal even when the script itself comes through a pipe.
if [ -t 1 ] && (: </dev/tty) 2>/dev/null; then TTY=/dev/tty; else TTY=""; fi
ask() {
  # ask <question> <default>: the answer, or the default without a terminal or on Enter.
  if [ -n "$TTY" ]; then
    printf '%s [%s]: ' "$1" "$2" >"$TTY"
    read -r answer <"$TTY" || answer=""
    printf '%s' "${answer:-$2}"
  else
    printf '%s' "$2"
  fi
}
ask_secret() {
  if [ -n "$TTY" ]; then
    printf '%s: ' "$1" >"$TTY"
    stty -echo <"$TTY" 2>/dev/null || true
    read -r answer <"$TTY" || answer=""
    stty echo <"$TTY" 2>/dev/null || true
    printf '\n' >"$TTY"
    printf '%s' "$answer"
  fi
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running, or this user may not use it (try sudo, or add yourself to the docker group)"
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  fail "Docker Compose is missing: https://docs.docker.com/compose/install/"
fi

mkdir -p "$DIR"
cd "$DIR"

cat >compose.yaml <<EOF
# Written by https://darkbeacon.space/install.sh; running it again rewrites this file.
services:
  darkbeacon:
    image: ${IMAGE}:\${DARKBEACON_VERSION:-${VERSION}}
    restart: unless-stopped
    env_file: .env
    ports:
      - '\${DARKBEACON_PORT:-${PORT}}:3000'
    volumes:
      - dbk-data:/data

volumes:
  dbk-data:
EOF

if [ -f .env ]; then
  say "Keeping $DIR/.env; updating the image."
else
  say "Setting up Darkbeacon in $DIR"
  url="${PUBLIC_URL:-$(ask 'Address people will open (PUBLIC_URL)' "http://localhost:$PORT")}"
  eve_id="${EVE_CLIENT_ID:-$(ask 'EVE application client id (Enter to add it later)' '')}"
  eve_secret="${EVE_CLIENT_SECRET:-}"
  if [ -n "$eve_id" ] && [ -z "$eve_secret" ]; then eve_secret="$(ask_secret 'EVE application secret key')"; fi
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32)"
  else
    secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  umask 077
  cat >.env <<EOF
# Darkbeacon settings. Every option: https://github.com/zanreal-labs/darkbeacon/blob/main/.env.example
PUBLIC_URL=${url}
SECRET_KEY=${secret}
EVE_CLIENT_ID=${eve_id}
EVE_CLIENT_SECRET=${eve_secret}
DARKBEACON_VERSION=${VERSION}
DARKBEACON_PORT=${PORT}
EOF
  chmod 600 .env
fi

compose pull
compose up -d

# The health check answers once the API and the web app both run.
url="$(sed -n 's/^PUBLIC_URL=//p' .env | head -n 1)"
port="$(sed -n 's/^DARKBEACON_PORT=//p' .env | head -n 1)"
command -v curl >/dev/null 2>&1 || { say "Darkbeacon is starting: ${url}"; exit 0; }
i=0
until curl -fs -o /dev/null "http://127.0.0.1:${port:-$PORT}/api/health" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    say "Darkbeacon is starting slower than usual; follow it with: cd $DIR && docker compose logs -f"
    exit 0
  fi
  sleep 2
done

say ""
say "Darkbeacon is running: ${url}"
say "The first account to sign in owns the instance."
if ! grep -q '^EVE_CLIENT_ID=.' .env; then
  say ""
  say "To sign in, make an EVE application at https://developers.eveonline.com with the callback"
  say "  ${url}/api/auth/eve/callback"
  say "put its client id and secret key into $DIR/.env (EVE_CLIENT_ID, EVE_CLIENT_SECRET),"
  say "then run: cd $DIR && docker compose up -d"
fi
say ""
say "Update later by running the installer again. Data lives in this project's Docker volume dbk-data;"
say "nothing is lost when the container is replaced."
