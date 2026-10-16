# Icons

`build.mjs` writes the static Darkbeacon icons from the mark's geometry (the same numbers as
`apps/web/src/shell/Logo.tsx`; `apps/web/src/shell/Logo.test.tsx` fails when they drift apart):

- `apps/web/public/favicon.svg` and `apps/web/public/icons/mark.svg`: the mark in the built-in light
  and dark colours, switching with `prefers-color-scheme`;
- `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` (PWA manifest) and
  `apple-touch-icon.png`, on the dark background;
- `docs/brand/mark-light.svg` and `mark-dark.svg` for the README.

It runs inside the Playwright image (Chromium renders the PNGs), never on the host:

```sh
docker run --rm --ipc=host -v "$PWD":/work -w /tmp mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c 'npm i --no-audit --no-fund playwright@1.55.0 >/dev/null && cp /work/tools/icons/build.mjs . && node build.mjs'
```

`PREVIEW=/work/<file>.png` also writes a sheet of the mark at 16-96 px, light and dark, brand and
mono.
