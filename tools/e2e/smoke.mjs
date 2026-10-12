// End-to-end smoke test of a running instance in demo mode: the first HTML is the prerendered
// shell with the signed-in parts streamed into it, a visit signs in without a sign-in page, the
// map renders from the server's snapshot and a change made elsewhere arrives live.
//
// Runs inside the Playwright image, never on the host (see tools/e2e/README.md):
//   BASE=http://<demo instance> node smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://app:3000';
const MAP = process.env.MAP ?? 'demo-chain';
const HOME = 31002531; // J014348, the demo chain's home system.

const checks = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    checks.push(name);
    console.log(`  ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
    process.exitCode = 1;
  }
}

/** Reads a streamed response chunk by chunk, noting when each marker first arrived. */
async function readStreamed(response, markers) {
  const seen = {};
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let html = '';
  for (let chunk = 0; ; chunk++) {
    const { value, done } = await reader.read();
    if (done) break;
    html += value;
    for (const [name, marker] of Object.entries(markers))
      if (!(name in seen) && html.includes(marker)) seen[name] = chunk;
  }
  return { html, seen };
}

async function run() {
  console.log(`smoke test against ${BASE}`);

  await check('health reflects the API and the web server', async () => {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.web, 'ok');
  });

  await check('first HTML for / is the prerendered shell, signed in, with the rest streamed', async () => {
    // As a browser opening the page: only page visits get a demo session.
    const response = await fetch(`${BASE}/`, {
      redirect: 'manual',
      headers: { 'sec-fetch-dest': 'document' },
    });
    assert.equal(response.status, 200, 'no redirect to the sign-in page');
    assert.equal(response.headers.get('x-nextjs-prerender'), '1', 'served from the static shell');
    assert.equal(response.headers.get('x-nextjs-postponed'), '1', 'with dynamic parts resumed');
    assert.match(response.headers.getSetCookie().join('\n'), /dbk_session=/, 'signed in on the server');
    const { html, seen } = await readStreamed(response, {
      rail: 'aria-label="Darkbeacon home"',
      skeleton: 'aria-label="Loading maps"',
      account: 'aria-label="Account: Demo pilot"',
      maps: 'Demo chain',
    });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    for (const part of ['rail', 'skeleton', 'account', 'maps'])
      assert.ok(part in seen, `${part} in the HTML`);
    assert.ok(seen.rail <= seen.account, 'the shell comes before the streamed account');
    assert.ok(html.indexOf('aria-label="Loading maps"') < html.indexOf('Demo chain'), 'fallback first');
    assert.match(html, /<style id="dbk-themes">/);
    assert.match(html, /prefers-color-scheme: dark/);
  });

  await check('crawlers, scanners and HEAD requests get no demo session', async () => {
    const asks = [
      ['GET', '/robots.txt'],
      ['GET', '/wp-login.php'],
      ['GET', '/apple-touch-icon.png'],
      ['GET', '/.well-known/security.txt'],
      ['HEAD', '/'],
      ['GET', '/m/demo-chain'], // no Sec-Fetch-Dest: a link preview, not a browser
    ];
    for (const [method, path] of asks) {
      const response = await fetch(`${BASE}${path}`, { method, redirect: 'manual' });
      await response.body?.cancel();
      const cookies = response.headers.getSetCookie().join('\n');
      assert.doesNotMatch(cookies, /dbk_session=/, `${method} ${path} -> ${response.status}`);
      if (path !== '/' && path !== '/m/demo-chain') assert.equal(response.status, 404, `${method} ${path}`);
    }
  });

  await check('sign-in redirects never leave the site', async () => {
    const asks = [
      ['/login?reset=1&next=/%5Cevil.example/phish', {}],
      ['/login?reset=1&next=/%09/evil.example', {}],
      ['/login?next=/%5Cevil.example', { cookie: 'dbk_session=x' }],
      ['/admin', { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }],
    ];
    for (const [path, headers] of asks) {
      const response = await fetch(`${BASE}${path}`, { redirect: 'manual', headers });
      await response.body?.cancel();
      assert.equal(response.status, 307, path);
      const location = response.headers.get('location');
      assert.ok(location.startsWith('/') && !location.startsWith('//'), `${path} -> ${location}`);
    }
  });

  const browser = await chromium.launch();
  try {
    await check('system dark mode is right on the first paint, without any script', async () => {
      const context = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`${BASE}/login`);
      const bg = await page.evaluate(
        () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
      );
      await context.close();
      const light = await browser.newContext({ colorScheme: 'light', javaScriptEnabled: false });
      const lightPage = await light.newPage();
      await lightPage.goto(`${BASE}/login`);
      const lightBg = await lightPage.evaluate(
        () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
      );
      await light.close();
      assert.notEqual(bg, lightBg);
    });

    await check('an explicit theme from the cookie applies before the page renders', async () => {
      const context = await browser.newContext({ colorScheme: 'dark' });
      const host = new URL(BASE).hostname;
      await context.addCookies([{ name: 'dbk_theme', value: 'default', domain: host, path: '/' }]);
      const page = await context.newPage();
      // Recorded by the first script on the page, before React or any app code runs.
      await page.addInitScript(() => {
        globalThis.document.addEventListener('DOMContentLoaded', () => {
          globalThis.__themeAtLoad = globalThis.document.documentElement.dataset.theme ?? 'none';
        });
      });
      await page.goto(`${BASE}/login`);
      assert.equal(await page.evaluate(() => globalThis.__themeAtLoad), 'default');
      await context.close();
    });

    await check("a new browser starts with the account's theme, before any script", async () => {
      // The (shared) demo account picks dark; a browser that never saw it opens the app.
      const admin = await browser.newContext();
      assert.equal((await admin.request.post(`${BASE}/api/auth/demo`)).status(), 200);
      const pick = (themeId) => admin.request.put(`${BASE}/api/accounts/me/theme`, { data: { themeId } });
      assert.equal((await pick('dark')).status(), 200);
      try {
        const context = await browser.newContext({ colorScheme: 'light' });
        const page = await context.newPage();
        await page.addInitScript(() => {
          globalThis.document.addEventListener('DOMContentLoaded', () => {
            globalThis.__themeAtLoad = globalThis.document.documentElement.dataset.theme ?? 'none';
          });
        });
        await page.goto(`${BASE}/`);
        assert.equal(await page.evaluate(() => globalThis.__themeAtLoad), 'dark');
        await context.close();
      } finally {
        await pick(null);
        await admin.close();
      }
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    const navigations = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on(
      'framenavigated',
      (frame) => frame === page.mainFrame() && navigations.push(new URL(frame.url()).pathname),
    );

    await check('a demo visit lands in the app, signed in, without a sign-in page', async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole('link', { name: /^Demo chain/ }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Account: Demo pilot' }).waitFor();
      assert.ok(!navigations.includes('/login'), `navigations: ${navigations.join(', ')}`);
    });

    await check('the maps list opens the map and back without a full page load', async () => {
      // A full load would drop this marker.
      await page.evaluate(() => (globalThis.__sameDocument = true));
      await page.getByRole('link', { name: /^Demo chain/ }).click();
      await page.waitForURL(`**/m/${MAP}`);
      await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Maps' }).click();
      await page.getByRole('link', { name: /^Demo chain/ }).waitFor();
      assert.equal(await page.evaluate(() => globalThis.__sameDocument), true);
    });

    await check('the map renders from the server snapshot and goes live', async () => {
      await page.goto(`${BASE}/m/${MAP}`);
      await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
      assert.ok((await page.locator('.react-flow__node').count()) >= 8, 'every demo system is on the map');
      await page.getByRole('status', { name: 'Realtime: Live' }).waitFor({ timeout: 15_000 });
    });

    await check('a change made elsewhere arrives live over the WebSocket', async () => {
      // Another browser (its own demo session) renames the home system over REST.
      const other = await browser.newContext();
      const api = other.request;
      await api.post(`${BASE}/api/auth/demo`);
      const maps = await (await api.get(`${BASE}/api/maps`)).json();
      const map = maps.find((m) => m.slug === MAP);
      assert.ok(map, 'the demo map');
      const name = `Live ${Date.now() % 100000}`;
      const answer = await api.patch(`${BASE}/api/maps/${map.id}/systems/${HOME}`, {
        data: { customName: name },
      });
      assert.equal(answer.status(), 200, await answer.text());
      await page.locator('.react-flow__node', { hasText: name }).waitFor({ timeout: 10_000 });
      await api.patch(`${BASE}/api/maps/${map.id}/systems/${HOME}`, { data: { customName: null } });
      await other.close();
    });
    await check('plugin widgets fit in the dock, open or closed', async () => {
      // Install and switch on the sample widget (the demo pilot owns the instance).
      const api = context.request;
      const installed = await api.post(`${BASE}/api/admin/plugins`, {
        data: { source: 'catalog:sample-widget' },
      });
      assert.ok([200, 201, 409].includes(installed.status()), await installed.text());
      const enabled = await api.put(`${BASE}/api/admin/plugins/sample-widget/enabled`, {
        data: { enabled: true },
      });
      assert.equal(enabled.status(), 200, await enabled.text());
      try {
        for (const width of [1440, 1024, 800]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`${BASE}/m/${MAP}`);
          await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
          const tablist = page.getByRole('tablist', { name: 'Widgets' });
          const pluginTab = tablist.getByRole('tab', { name: /Added since start|Sample/ });
          await pluginTab.waitFor({ timeout: 15_000 });
          for (const state of ['closed', 'open']) {
            const strip = await tablist.boundingBox();
            assert.ok(strip.x >= 0 && strip.x + strip.width <= width, `${width} ${state}: strip in view`);
            const gear = await page.getByRole('link', { name: 'Map settings' }).boundingBox();
            if (gear) assert.ok(gear.x + gear.width <= strip.x, `${width} ${state}: gear clear of the tabs`);
            // Clicking the plugin tab opens the dock on it, clicking it again closes the dock.
            await pluginTab.click();
            const panel = page.getByRole('tabpanel');
            await panel.waitFor({ state: state === 'closed' ? 'visible' : 'hidden' });
            const pageWidth = await page.evaluate(() => globalThis.document.documentElement.scrollWidth);
            assert.ok(pageWidth <= width, `${width} ${state}: no sideways page scroll`);
            const search = await page.getByRole('combobox', { name: 'Search systems to add' }).boundingBox();
            if (search) assert.ok(search.x >= 0, `${width} ${state}: the search box stays put`);
          }
        }
      } finally {
        await page.setViewportSize({ width: 1280, height: 720 });
        await api.delete(`${BASE}/api/admin/plugins/sample-widget`);
      }
    });

    await check('no script errors (hydration included) on the way', async () => {
      await page.goto(`${BASE}/admin`);
      await page.getByRole('heading', { name: 'Admin', exact: true }).waitFor();
      await page.goto(`${BASE}/account`);
      await page.getByRole('heading', { name: 'Account', exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.deepEqual(errors, []);
    });
    await context.close();
  } finally {
    await browser.close();
  }

  console.log(process.exitCode ? 'smoke test failed' : `all ${checks.length} checks passed`);
}

await run();
