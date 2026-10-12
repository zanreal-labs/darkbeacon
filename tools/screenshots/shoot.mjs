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
  await page.screenshot({ path: file, ...options });
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

async function tabsOf(page, scope = 'main') {
  return page.locator(`${scope} [role="tablist"]`).first().locator('[role="tab"]');
}

async function waitForMap(page) {
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
  // Fit-view and fonts.
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
          deviceScaleFactor: phone ? 2 : 1,
        });
        const p = await login.newPage();
        if (!LOGIN_BASE) {
          // The demo instance shows its sign-in page to someone who signed out of the demo.
          await login.addCookies([{ name: 'dbk_demo_out', value: '1', url: BASE }]);
        }
        await p.goto(`${LOGIN_BASE ?? BASE}/login`);
        await p
          .getByRole('button', { name: /discord|explore the demo/i })
          .or(p.getByRole('link', { name: /discord/i }))
          .first()
          .waitFor();
        await settle(p);
        await shot(p, 'signin', scheme, size);
        await login.close();
      });

      await scene('maps', async () => {
        await page.goto(`${BASE}/`);
        await page.getByText('Demo chain').first().waitFor({ timeout: 15_000 });
        await settle(page);
        await s('maps');
      });

      await scene('map', async () => {
        await page.goto(`${BASE}/m/${MAP}`);
        await waitForMap(page);
        await s('map');

        // Select the home system so the dock has content.
        const home = page.locator('.react-flow__node', { hasText: /J014348|Home/ }).first();
        await home.click();
        await settle(page);
        await s('map-selected');

        // Close-ups of nodes and edges, at twice the pixels.
        const box = await home.boundingBox();
        if (box) {
          const clip = {
            x: Math.max(0, box.x - 60),
            y: Math.max(0, box.y - 120),
            width: Math.min(560, viewport.width - Math.max(0, box.x - 60)),
            height: 320,
          };
          await s('map-closeup-nodes', { clip, scale: 'device' });
        }

        // Dock tabs.
        const dock = page.locator('[aria-label="Widgets"]').first();
        const tabs = dock.locator('[role="tab"]');
        const count = await tabs.count();
        for (let i = 0; i < count; i++) {
          const tab = tabs.nth(i);
          const label = (await tab.innerText()).trim().split('\n')[0].toLowerCase();
          if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
          await settle(page);
          await s(`map-dock-${label.replace(/[^a-z0-9]+/g, '-')}`);
        }
        // Leave the dock as it was (closed on phones).
        if (phone && (await tabs.count())) {
          const open = dock.locator('[role="tab"][aria-selected="true"]');
          if (await open.count()) await open.first().click();
          await settle(page);
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
        await page.goto(`${BASE}/m/${MAP}/settings`);
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
        await page.goto(`${BASE}/admin`);
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
        }
      });

      await scene('account', async () => {
        await page.goto(`${BASE}/account`);
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15_000 });
        await settle(page, 600);
        await s('account', { fullPage: true });
      });

      await scene('not-found', async () => {
        await page.goto(`${BASE}/m/no-such-map`);
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
