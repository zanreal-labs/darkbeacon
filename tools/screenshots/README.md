# Screenshots

`shoot.mjs` opens every screen of a running instance in light and dark, at 1440x900 and 390x844, and
writes PNGs to `docs/screenshots/` (`<screen>--<size>-<scheme>.png`). It runs inside the Playwright
image, never on the host.

```sh
# A demo instance and one without demo mode (for the sign-in page), on a private network.
docker network create dbk-shots
docker build -t darkbeacon:shots .
docker run -d --rm --name dbk-demo --network dbk-shots -e DEMO_MODE=true -e ALLOW_DEMO_MODE=true darkbeacon:shots
docker run -d --rm --name dbk-login --network dbk-shots \
  -e DISCORD_CLIENT_ID=0 -e DISCORD_CLIENT_SECRET=x -e EVE_CLIENT_ID=0 -e EVE_CLIENT_SECRET=x darkbeacon:shots

docker run --rm --network dbk-shots --ipc=host -v "$PWD":/work -w /tmp \
  -e BASE=http://dbk-demo:3000 -e LOGIN_BASE=http://dbk-login:3000 \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c 'npm i --no-audit --no-fund playwright@1.55.0 >/dev/null && cp /work/tools/screenshots/shoot.mjs . && node shoot.mjs'

docker rm -f dbk-demo dbk-login && docker network rm dbk-shots
```

Every navigation waits for the network to go idle, so the page is hydrated before the tool clicks
anything; shots use reduced motion. Besides the screens it takes close-ups of nodes and an edge, the
dock tabs, the context menus and the connection legend.

`ONLY=<regex>` limits the run to some scenes (`signin`, `maps`, `map`, `map-settings`, `admin`,
`account`, `not-found`); `SIZES` and `SCHEMES` take comma separated lists.
