# Screenshots

`shoot.mjs` opens every screen of a running instance in light and dark, at 1440x900 and 390x844, and
writes PNGs to `docs/screenshots/` (`<screen>--<size>-<scheme>.png`). It runs inside the Playwright
image, never on the host.

```sh
# A demo instance and one without demo mode (for the sign-in page), on a private network.
docker network create ww-shots
docker build -t wormwright:shots .
docker run -d --rm --name ww-demo --network ww-shots -e DEMO_MODE=true -e ALLOW_DEMO_MODE=true wormwright:shots
docker run -d --rm --name ww-login --network ww-shots \
  -e DISCORD_CLIENT_ID=0 -e DISCORD_CLIENT_SECRET=x -e EVE_CLIENT_ID=0 -e EVE_CLIENT_SECRET=x wormwright:shots

docker run --rm --network ww-shots --ipc=host -v "$PWD":/work -w /tmp \
  -e BASE=http://ww-demo:3000 -e LOGIN_BASE=http://ww-login:3000 \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c 'npm i --no-audit --no-fund playwright@1.55.0 >/dev/null && cp /work/tools/screenshots/shoot.mjs . && node shoot.mjs'
```

`ONLY=<regex>` limits the run to some scenes (`signin`, `maps`, `map`, `map-settings`, `admin`,
`account`, `not-found`); `SIZES` and `SCHEMES` take comma separated lists.
