# End-to-end smoke test

`smoke.mjs` checks a running instance in demo mode from the outside: `/` redirects straight to the
map before any HTML, the first HTML of All maps is the prerendered shell with the signed-in parts
streamed into it, the system colour scheme is right without any script, a saved theme applies
before the page renders, a visit lands on the map signed in (no sign-in page, no list), the map
switcher reaches All maps without a full page load, the map renders from the server's snapshot
and a change made by another browser arrives live. It also checks that crawlers and scanners get no demo session, that
sign-in redirects never leave the site, that a new browser starts with the account's theme and
that a plugin widget fits in the map dock. It runs inside the Playwright image, never on the host.

With `EVE_BASE` it also checks an instance where Discord is not configured: the sign-in page offers
EVE Online only, signing in goes through a fake EVE SSO (`fake-eve.mjs`, which the test runs itself
under the names `login.eveonline.com` and `esi.evetech.net` on the test network, with a throwaway
certificate from `make-certs.sh`) and creates the owner account, and the name pickers search
corporations through the fake ESI. On the demo instance it also checks that `/` opens a starred
map, that routes and exits come from the routing API, that the history of a system says who renamed
it, and that two browsers on a map see each other's cursors through presence.

```sh
docker network create dbk-e2e
docker volume create dbk-e2e-certs
docker build -t darkbeacon:dev .
docker run --rm -v dbk-e2e-certs:/certs -v "$PWD/tools/e2e":/e2e:ro mcr.microsoft.com/playwright:v1.55.0-noble \
  sh /e2e/make-certs.sh /certs
# Both instances reach the fake EVE (the names are on the test network), so both trust its CA.
docker run -d --rm --name dbk-e2e-app --network dbk-e2e -v dbk-e2e-certs:/certs:ro \
  -e NODE_EXTRA_CA_CERTS=/certs/ca.pem -e DEMO_MODE=true -e ALLOW_DEMO_MODE=true darkbeacon:dev
docker run -d --rm --name dbk-e2e-eve --network dbk-e2e -v dbk-e2e-certs:/certs:ro \
  -e EVE_CLIENT_ID=e2e-client -e EVE_CLIENT_SECRET=e2e-secret -e PUBLIC_URL=http://dbk-e2e-eve:3000 \
  -e NODE_EXTRA_CA_CERTS=/certs/ca.pem darkbeacon:dev

docker run --rm --network dbk-e2e --network-alias login.eveonline.com --network-alias esi.evetech.net \
  --ipc=host -v "$PWD":/work:ro -v dbk-e2e-certs:/certs:ro -w /tmp \
  -e BASE=http://dbk-e2e-app:3000 -e EVE_BASE=http://dbk-e2e-eve:3000 \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c 'npm i --no-audit --no-fund playwright@1.55.0 >/dev/null && cp /work/tools/e2e/*.mjs . && node smoke.mjs'

docker rm -f dbk-e2e-app dbk-e2e-eve && docker network rm dbk-e2e && docker volume rm dbk-e2e-certs
```
