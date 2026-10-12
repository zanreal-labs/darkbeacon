// Captures every screen of a running instance in light and dark, desktop and phone.
//
// Runs inside the Playwright image, never on the host (see tools/screenshots/README.md):
//   BASE=http://<demo instance> LOGIN_BASE=http://<instance without demo mode> node shoot.mjs
//
// BASE must run with DEMO_MODE=true (the demo account is an instance owner and owns "Demo chain").
// LOGIN_BASE (optional) is an instance without demo mode for the sign-in page; without it the
// sign-in page is shot on BASE as someone who signed out of the demo sees it.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://app:3000';
const LOGIN_BASE = process.env.LOGIN_BASE || undefined;
/** Optional: an instance with EVE SSO and no Discord, whose sign-in page offers EVE Online. */
const EVE_LOGIN_BASE = process.env.EVE_LOGIN_BASE || undefined;
const OUT = process.env.OUT ?? '/work/docs/screenshots';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const SCHEMES = (process.env.SCHEMES ?? 'light,dark').split(',');
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SIZES = (process.env.SIZES ?? 'desktop,mobile').split(',');
const MAP = process.env.MAP ?? 'demo-chain';

const settle = (page, ms = 350) => page.waitForTimeout(ms);
/** Clicks in a fresh headless page count as keyboard focus; drop it so shots show what a mouse user sees. */
const blur = (page) => page.evaluate(() => globalThis.document.activeElement?.blur?.());
const failures = [];

async function shot(page, name, scheme, size, options = {}) {
  const file = join(OUT, `${name}--${size}-${scheme}.png`);
  // The page scrolls inside the shell's <main>; let it grow so a full-page shot shows everything.
  const unclip = options.fullPage
    ? await page.evaluate(() => {
        const main = globalThis.document.getElementById('main');
        const shell = main?.parentElement;
        if (!main || !shell) return false;
        main.style.overflow = 'visible';
        shell.style.height = 'auto';
        shell.style.minHeight = '100dvh';
        return true;
      })
    : false;
  await page.screenshot({ path: file, ...options });
  if (unclip) {
    await page.evaluate(() => {
      const main = globalThis.document.getElementById('main');
      main.style.overflow = '';
      main.parentElement.style.height = '';
      main.parentElement.style.minHeight = '';
    });
  }
  console.log('  ', file.replace(`${OUT}/`, ''));
}

/** Runs one named scene; a failing scene is reported and the run goes on. */
async function scene(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${error.message.split('\n')[0]}`);
    console.error('  !', name, error.message.split('\n')[0]);
  }
}

/**
 * Opens a page and waits until it is interactive: the server streams the HTML in, and clicks
 * before React hydrated it would do nothing.
 */
async function open(page, url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function tabsOf(page, scope = 'main') {
  return page.locator(`${scope} [role="tablist"]`).first().locator('[role="tab"]');
}

async function waitForMap(page) {
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
  // The first fit waits for React Flow to measure the nodes; then fonts.
  await page.waitForFunction(() => {
    const t = globalThis.document.querySelector('.react-flow__viewport')?.style.transform ?? '';
    return t !== '' && t !== 'translate(0px, 0px) scale(1)';
  });
  await settle(page, 700);
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const scheme of SCHEMES) {
    for (const size of SIZES) {
      const viewport = VIEWPORTS[size];
      const phone = size === 'mobile';
      console.log(`${size} ${scheme}`);
      const context = await browser.newContext({
        viewport,
        colorScheme: scheme,
        reducedMotion: 'reduce',
        deviceScaleFactor: phone ? 2 : 1,
        isMobile: phone,
        hasTouch: phone,
      });
      const page = await context.newPage();
      const s = (name, opts) => shot(page, name, scheme, size, opts);

      await scene('signin', async () => {
        const login = await browser.newContext({
          viewport,
          colorScheme: scheme,
          reducedMotion: 'reduce',
          deviceScaleFactor: phone ? 2 : 1,
        });
        const p = await login.newPage();
        if (!LOGIN_BASE) {
          // The demo instance shows its sign-in page to someone who signed out of the demo.
          await login.addCookies([{ name: 'dbk_demo_out', value: '1', url: BASE }]);
        }
        await open(p, `${LOGIN_BASE ?? BASE}/login`);
        await p
          .getByRole('button', { name: /discord|explore the demo/i })
          .or(p.getByRole('link', { name: /discord|eve online/i }))
          .first()
          .waitFor();
        await settle(p);
        await shot(p, 'signin', scheme, size);
        await login.close();
      });

      // An instance whose people sign in with EVE Online (no Discord configured).
      if (EVE_LOGIN_BASE) {
        await scene('signin-eve', async () => {
          const login = await browser.newContext({
            viewport,
            colorScheme: scheme,
            reducedMotion: 'reduce',
            deviceScaleFactor: phone ? 2 : 1,
          });
          const p = await login.newPage();
          await open(p, `${EVE_LOGIN_BASE}/login`);
          await p.getByRole('link', { name: 'Log in with EVE Online' }).waitFor();
          await p.waitForFunction(() =>
            [...globalThis.document.images].every((img) => img.complete && img.naturalWidth > 0),
          );
          await settle(p);
          await shot(p, 'signin-eve', scheme, size);
          await login.close();
        });
      }

      await scene('landing', async () => {
        // `/` opens the map straight away: no list in between.
        await open(page, `${BASE}/`);
        if (!new URL(page.url()).pathname.startsWith('/m/')) throw new Error(`/ landed on ${page.url()}`);
      });

      await scene('maps', async () => {
        await open(page, `${BASE}/maps`);
        await page.getByText('Demo chain').first().waitFor({ timeout: 15_000 });
        await settle(page);
        await s('maps');
      });

      await scene('map', async () => {
        await open(page, `${BASE}/m/${MAP}`);
        await waitForMap(page);
        await s('map');

        // The map switcher on the map's name in the top bar.
        await page.getByRole('button', { name: /switch map/i }).click();
        await settle(page);
        await s('map-switcher');
        await page.keyboard.press('Escape');
        await settle(page, 200);

        // Select the home system: the sidebar shows it.
        const home = page.locator('.react-flow__node', { hasText: /J014348|Home/ }).first();
        await home.click();
        await settle(page);
        await s('map-selected');

        // Close-ups of nodes and edges, at twice the pixels.
        const box = await home.boundingBox();
        if (box) {
          const clip = {
            x: Math.max(0, box.x - 80),
            y: Math.max(0, box.y - 140),
            width: Math.min(640, viewport.width - Math.max(0, box.x - 80)),
            height: 380,
          };
          await s('map-closeup-nodes', { clip, scale: 'device' });
        }

        // The system sidebar on its own; on phones the sheet opened to half.
        const sidebar = page.getByRole('complementary', { name: 'System' });
        if (await sidebar.count()) {
          if (phone) {
            await sidebar.getByRole('button', { name: 'Expand the panel' }).click();
            await settle(page);
            await s('map-sidebar');
            await sidebar.getByRole('button', { name: /Expand the panel fully/ }).click();
            await sidebar.getByRole('button', { name: 'Collapse the panel' }).click();
            await settle(page);
          } else {
            const clip = await sidebar.boundingBox();
            if (clip) await s('map-sidebar', { clip });
          }
        }

        // Context menus: system, connection, canvas.
        await home.click({ button: 'right' });
        await settle(page);
        await s('map-menu-system');
        await page.keyboard.press('Escape');
        await settle(page, 200);

        const edge = page.locator('.react-flow__edge').first();
        const edgeBox = await edge.boundingBox();
        if (edgeBox) {
          // The interaction path covers the edge; aim at its middle.
          const path = edge.locator('path').last();
          const point = await path.evaluate((el) => {
            const total = el.getTotalLength();
            const p = el.getPointAtLength(total / 2);
            const m = el.getScreenCTM();
            return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
          });
          await page.mouse.click(point.x, point.y, { button: 'right' });
          await settle(page);
          await s('map-menu-connection');
          await page.mouse.move(point.x, point.y);
          await page.keyboard.press('Escape');
          await settle(page, 200);
          await page.mouse.click(point.x, point.y);
          await settle(page);
          await s('map-closeup-edge', {
            clip: {
              x: Math.max(0, point.x - 200),
              y: Math.max(0, point.y - 120),
              width: Math.min(400, viewport.width - Math.max(0, point.x - 200)),
              height: 240,
            },
            scale: 'device',
          });
        }

        // The connection legend, open over the canvas.
        await page.getByRole('button', { name: /^Show the legend/ }).click();
        await page.mouse.move(viewport.width / 2, 10);
        await settle(page);
        await s('map-legend');
        await page.getByRole('button', { name: /^Hide the legend/ }).click();
        await settle(page, 200);

        const pane = page.locator('.react-flow__pane');
        const paneBox = await pane.boundingBox();
        if (paneBox) {
          await page.mouse.click(paneBox.x + 24, paneBox.y + paneBox.height - 120, { button: 'right' });
          await settle(page);
          await s('map-menu-canvas');
          await page.keyboard.press('Escape');
        }
      });

      await scene('map-settings', async () => {
        await open(page, `${BASE}/m/${MAP}/settings`);
        const tabs = await tabsOf(page);
        await tabs.first().waitFor({ timeout: 15_000 });
        await settle(page);
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          const label = (await tab.innerText()).trim().toLowerCase();
          await tab.click();
          await blur(page);
          await settle(page, 600);
          await s(`map-settings-${label.replace(/[^a-z0-9]+/g, '-')}`, { fullPage: true });
        }
      });

      await scene('admin', async () => {
        await open(page, `${BASE}/admin`);
        const tabs = await tabsOf(page);
        await tabs.first().waitFor({ timeout: 15_000 });
        await settle(page);
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          const label = (await tab.innerText()).trim().toLowerCase();
          await tab.click();
          await blur(page);
          await settle(page, 600);
          await s(`admin-${label.replace(/[^a-z0-9]+/g, '-')}`, { fullPage: true });
          if (label === 'audit') {
            // Retention and the integrity check sit below the activity feed.
            const check = page.getByRole('button', { name: 'Check integrity' });
            await check.scrollIntoViewIfNeeded();
            await check.click();
            await page.getByText(/Every history is intact|was changed outside/).waitFor({ timeout: 15_000 });
            await blur(page);
            await page.getByRole('heading', { name: 'Keep history' }).scrollIntoViewIfNeeded();
            await settle(page);
            await s('admin-audit-integrity');
          }
        }
      });

      await scene('account', async () => {
        await open(page, `${BASE}/account`);
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15_000 });
        await settle(page, 600);
        await s('account', { fullPage: true });
      });

      await scene('components', async () => {
        await open(page, `${BASE}/dev/components`);
        await page.getByRole('heading', { name: 'Components' }).waitFor({ timeout: 15_000 });
        await settle(page, 600);
        await s('components', { fullPage: true });
      });

      await scene('not-found', async () => {
        await open(page, `${BASE}/m/no-such-map`);
        await settle(page, 1200);
        await s('map-missing');
      });

      await context.close();
    }
  }
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} scene(s) failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  }
}

await run();
