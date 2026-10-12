#!/bin/sh
# A throwaway CA and one certificate for the EVE hosts the fake answers as (fake-eve.mjs). The
# EVE-only instance trusts the CA through NODE_EXTRA_CA_CERTS; nothing else ever should.
# Runs inside the Playwright image: sh make-certs.sh <dir>
set -eu
dir=${1:-/certs}
cd "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Darkbeacon e2e CA' \
  -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=login.eveonline.com' \
  -keyout eve-key.pem -out eve.csr 2>/dev/null
printf 'subjectAltName=DNS:login.eveonline.com,DNS:esi.evetech.net\n' > san.ext
openssl x509 -req -in eve.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 2 \
  -extfile san.ext -out eve.pem 2>/dev/null
rm -f eve.csr san.ext ca.srl ca-key.pem
chmod 644 ./*.pem
