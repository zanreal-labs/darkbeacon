// Builds the static Darkbeacon icons: the favicon, the PWA and Apple touch icons and the README
// marks. The geometry is the one in apps/web/src/shell/Logo.tsx (a test checks they agree).
//
// Runs inside the Playwright image, never on the host (see tools/icons/README.md).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = process.env.ROOT ?? '/work';
const PUBLIC = join(ROOT, 'apps/web/public');

const MARK = {
  core: 3.25,
  ring: 7.25,
  ringWidth: 1.75,
  beamInner: 4.5,
  beamOuter: 12.25,
  beamSpread: 24,
  gap: 1.1,
};
/** The core sits a little low and left, so the mark with its beam is centred in the square. */
const CX = 11;
const CY = 13;
const rad = (deg) => (deg * Math.PI) / 180;
const at = (r, deg) =>
  `${(CX + r * Math.cos(rad(deg))).toFixed(3)} ${(CY + r * Math.sin(rad(deg))).toFixed(3)}`;

export function beamPath(grow = 0) {
  const tip = MARK.beamInner - grow * 1.6;
  const outer = MARK.beamOuter + grow;
  // Grow the angle so the clearance is about `grow` px where the beam crosses the ring.
  const spread = MARK.beamSpread + (grow / MARK.ring) * (180 / Math.PI);
  return [
    `M ${at(tip, -45)}`,
    `L ${at(outer, -45 - spread)}`,
    `A ${outer} ${outer} 0 0 1 ${at(outer, -45 + spread)}`,
    'Z',
  ].join(' ');
}

// The built-in themes' text and accent colours (theme-sdk), light and dark.
const LIGHT = { fg: '#14171f', accent: '#0b7f91', bg: '#f7f8fa' };
const DARK = { fg: '#e6e9ef', accent: '#38c6d6', bg: '#0d0f14' };

/** The mark's shapes, coloured by `paint` (fill/stroke attributes for the ring, core and beam). */
function shapes(paint, { inset = 0, scale = 1 } = {}) {
  const t = inset ? ` transform="translate(${inset} ${inset}) scale(${scale})"` : '';
  return `<defs><mask id="gap" maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36"><rect x="-6" y="-6" width="36" height="36" fill="#fff"/><path d="${beamPath(MARK.gap)}" fill="#000"/></mask></defs>
<g${t}><circle cx="${CX}" cy="${CY}" r="${MARK.ring}" fill="none" stroke-width="${MARK.ringWidth}" ${paint.ring} mask="url(#gap)"/><circle cx="${CX}" cy="${CY}" r="${MARK.core}" ${paint.core}/><path d="${beamPath()}" ${paint.beam}/></g>`;
}

const solid = ({ fg, accent }) => ({
  ring: `stroke="${fg}"`,
  core: `fill="${fg}"`,
  beam: `fill="${accent}"`,
});

const svg = (body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${extra}>\n${body}\n</svg>\n`;

/** Follows the browser's colour scheme (favicons and the README in either GitHub theme). */
const adaptive = svg(
  `<style>.r{stroke:${LIGHT.fg}}.c{fill:${LIGHT.fg}}.b{fill:${LIGHT.accent}}@media (prefers-color-scheme:dark){.r{stroke:${DARK.fg}}.c{fill:${DARK.fg}}.b{fill:${DARK.accent}}}</style>
${shapes({ ring: 'class="r"', core: 'class="c"', beam: 'class="b"' })}`,
);

/**
 * On a solid tile, for home screens: rounded for plain icons, square for the maskable icon (its mark
 * inside the 80 % safe zone) and for Apple, which rounds the corners itself.
 */
const tile = (palette, { inset = 3, radius = 5.5 } = {}) => {
  const scale = (24 - 2 * inset) / 24;
  return svg(
    `<rect width="24" height="24" rx="${radius}" fill="${palette.bg}"/>
${shapes(solid(palette), { inset, scale })}`,
  );
};

const files = {
  [join(PUBLIC, 'favicon.svg')]: adaptive,
  [join(PUBLIC, 'icons/mark.svg')]: adaptive,
  [join(ROOT, 'docs/brand/mark-light.svg')]: svg(shapes(solid(LIGHT))),
  [join(ROOT, 'docs/brand/mark-dark.svg')]: svg(shapes(solid(DARK))),
};
for (const [file, content] of Object.entries(files)) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  console.log('  ', file.replace(`${ROOT}/`, ''));
}

// Raster icons through Chromium (Playwright image only).
if (process.env.SKIP_PNG !== '1') {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const png = async (file, content, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${content.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log('  ', file.replace(`${ROOT}/`, ''));
  };
  await png(join(PUBLIC, 'icons/icon-192.png'), tile(DARK), 192);
  await png(join(PUBLIC, 'icons/icon-512.png'), tile(DARK), 512);
  await png(join(PUBLIC, 'icons/icon-maskable-512.png'), tile(DARK, { inset: 4.8, radius: 0 }), 512);
  await png(join(PUBLIC, 'icons/apple-touch-icon.png'), tile(DARK, { radius: 0 }), 180);
  // A preview sheet of the mark at the sizes it must survive, light and dark.
  if (process.env.PREVIEW) {
    const sizes = [16, 20, 24, 32, 48, 96];
    const row = (p) =>
      `<div style="display:flex;gap:16px;align-items:center;padding:16px;background:${p.bg}">${sizes
        .map((s) => svg(shapes(solid(p))).replace('<svg ', `<svg width="${s}" height="${s}" `))
        .join('')}${sizes
        .map((s) =>
          svg(shapes(solid({ fg: p.fg, accent: p.fg }))).replace('<svg ', `<svg width="${s}" height="${s}" `),
        )
        .join('')}</div>`;
    await page.setViewportSize({ width: 900, height: 300 });
    await page.setContent(`<html><body style="margin:0">${row(LIGHT)}${row(DARK)}</body></html>`);
    await page.screenshot({ path: process.env.PREVIEW, fullPage: true });
  }
  await browser.close();
}
