# End-to-end smoke test

`smoke.mjs` checks a running instance in demo mode from the outside: the first HTML for `/` is the
prerendered shell with the signed-in parts streamed into it, the system colour scheme is right
without any script, a saved theme applies before the page renders, a visit lands in the app
signed in (no sign-in page), the map renders from the server's snapshot and a change made by
another browser arrives live. It also checks that crawlers and scanners get no demo session, that
sign-in redirects never leave the site, that a new browser starts with the account's theme and
that a plugin widget fits in the map dock. It runs inside the Playwright image, never on the host.

```sh
docker network create dbk-e2e
docker build -t darkbeacon:dev .
docker run -d --rm --name dbk-e2e-app --network dbk-e2e -e DEMO_MODE=true -e ALLOW_DEMO_MODE=true darkbeacon:dev

docker run --rm --network dbk-e2e --ipc=host -v "$PWD":/work:ro -w /tmp -e BASE=http://dbk-e2e-app:3000 \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c 'npm i --no-audit --no-fund playwright@1.55.0 >/dev/null && cp /work/tools/e2e/smoke.mjs . && node smoke.mjs'

docker rm -f dbk-e2e-app && docker network rm dbk-e2e
```
