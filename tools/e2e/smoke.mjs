// End-to-end smoke test of a running instance in demo mode: the first HTML is the prerendered
// shell with the signed-in parts streamed into it, a visit signs in without a sign-in page, the
// map renders from the server's snapshot and a change made elsewhere arrives live; `/` opens the
// starred map, routes and exits come from the routing API, history records who changed what and
// two browsers see each other on the map. With EVE_BASE it also signs in to an EVE-only instance
// through a fake EVE SSO and ESI (fake-eve.mjs) and searches names in a picker.
//
// Runs inside the Playwright image, never on the host (see tools/e2e/README.md):
//   BASE=http://<demo instance> [EVE_BASE=http://<EVE-only instance>] node smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://app:3000';
const MAP = process.env.MAP ?? 'demo-chain';
const HOME = 31002531; // J014348, the demo chain's home system.
const JITA = 30000142;
/** An instance with EVE SSO and no Discord, whose EVE hosts resolve to this container. */
const EVE_BASE = process.env.EVE_BASE || undefined;
const EVE_CLIENT = {
  id: process.env.EVE_CLIENT_ID ?? 'e2e-client',
  secret: process.env.EVE_CLIENT_SECRET ?? 'e2e-secret',
};
const CERT_DIR = process.env.CERT_DIR ?? '/certs';

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
  console.log(`smoke test against ${BASE}${EVE_BASE ? ` and ${EVE_BASE}` : ''}`);
  // The EVE hosts resolve to this container on the test network, for both instances: answer them
  // from the start, so nothing on the demo instance finds EVE unreachable.
  const fake = EVE_BASE
    ? await (
        await import('./fake-eve.mjs')
      ).startFakeEve({
        client: EVE_CLIENT,
        certFile: `${CERT_DIR}/eve.pem`,
        keyFile: `${CERT_DIR}/eve-key.pem`,
      })
    : null;

  await check('health reflects the API and the web server', async () => {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.web, 'ok');
  });

  await check('/ goes straight to the map, signed in, before any HTML', async () => {
    const response = await fetch(`${BASE}/`, {
      redirect: 'manual',
      headers: { 'sec-fetch-dest': 'document' },
    });
    await response.body?.cancel();
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location'), BASE).pathname, `/m/${MAP}`);
    assert.match(response.headers.getSetCookie().join('\n'), /dbk_session=/, 'signed in on the server');
  });

  await check(
    'first HTML of All maps is the prerendered shell, signed in, with the rest streamed',
    async () => {
      // As a browser opening the page: only page visits get a demo session.
      const response = await fetch(`${BASE}/maps`, {
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
    },
  );

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
    await check('/ opens the map the account starred, then the usual one again', async () => {
      const demo = await browser.newContext();
      const api = demo.request;
      assert.equal((await api.post(`${BASE}/api/auth/demo`)).status(), 200);
      const created = await api.post(`${BASE}/api/maps`, {
        data: { name: 'E2E landing', slug: 'e2e-landing' },
      });
      assert.equal(created.status(), 201, await created.text());
      const map = await created.json();
      const landing = () =>
        api.get(`${BASE}/`, { maxRedirects: 0, headers: { 'sec-fetch-dest': 'document' } });
      try {
        const starred = await api.put(`${BASE}/api/accounts/me/default-map`, { data: { mapId: map.id } });
        assert.equal(starred.status(), 200, await starred.text());
        let response = await landing();
        assert.equal(response.status(), 307);
        assert.equal(new URL(response.headers().location, BASE).pathname, '/m/e2e-landing');
        assert.equal((await (await api.get(`${BASE}/api/accounts/me/landing`)).json()).slug, 'e2e-landing');
        await api.put(`${BASE}/api/accounts/me/default-map`, { data: { mapId: null } });
        await api.delete(`${BASE}/api/maps/${map.id}`);
        response = await landing();
        assert.equal(new URL(response.headers().location, BASE).pathname, `/m/${MAP}`);
      } finally {
        await api.put(`${BASE}/api/accounts/me/default-map`, { data: { mapId: null } });
        await api.delete(`${BASE}/api/maps/${map.id}`);
        await demo.close();
      }
    });

    await check('routes and exits come from the routing API, through the chain', async () => {
      const demo = await browser.newContext();
      const api = demo.request;
      await api.post(`${BASE}/api/auth/demo`);
      const map = (await (await api.get(`${BASE}/api/maps`)).json()).find((m) => m.slug === MAP);
      const route = await (
        await api.get(`${BASE}/api/maps/${map.id}/route?from=${HOME}&to=${JITA}&mode=shortest`)
      ).json();
      assert.ok(route.jumps > 0, `jumps: ${route.jumps}`);
      assert.equal(route.steps[0].solarSystemId, HOME);
      assert.equal(route.steps.at(-1).name, 'Jita');
      assert.ok(
        route.steps.some((step) => step.via === 'wormhole'),
        'leaves the chain by wormhole',
      );
      const highsec = await api.get(`${BASE}/api/maps/${map.id}/route?from=${HOME}&to=${JITA}&mode=highsec`);
      assert.equal(highsec.status(), 200);
      const { exits } = await (await api.get(`${BASE}/api/maps/${map.id}/exits`)).json();
      const connected = exits.filter((e) => e.kind === 'connected');
      assert.ok(connected.length > 0, 'the demo chain reaches known space');
      for (const exit of connected) {
        assert.ok(exit.nearest && exit.nearest.jumps !== null, `${exit.name} has a nearest hub`);
        assert.ok(['high', 'low', 'null', 'mixed'].includes(exit.nearest.space), `${exit.name}: space`);
      }
      await demo.close();
    });

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

    await check('a demo visit lands on the map, signed in, without a sign-in page or a list', async () => {
      await page.goto(`${BASE}/`);
      await page.waitForURL(`**/m/${MAP}`);
      await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Account: Demo pilot' }).waitFor();
      assert.ok(!navigations.includes('/login'), `navigations: ${navigations.join(', ')}`);
      assert.ok(!navigations.includes('/maps'), `navigations: ${navigations.join(', ')}`);
    });

    await check('the map switcher opens All maps and back without a full page load', async () => {
      // A full load would drop this marker.
      await page.evaluate(() => (globalThis.__sameDocument = true));
      await page.getByRole('button', { name: /switch map/i }).click();
      await page.getByRole('menuitem', { name: 'All maps' }).click();
      await page.waitForURL('**/maps');
      await page.getByRole('link', { name: /^Demo chain/ }).click();
      await page.waitForURL(`**/m/${MAP}`);
      await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
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

      // The history of the system says who renamed it, from what to what.
      const history = await (
        await api.get(`${BASE}/api/maps/${map.id}/systems/${HOME}/history?limit=10`)
      ).json();
      const renamed = history.entries.find(
        (e) => e.type === 'system.updated' && e.diff.customName?.after === name,
      );
      assert.ok(renamed, 'the rename is in the history');
      assert.equal(renamed.actor.accountName, 'Demo pilot');
      assert.equal(renamed.channel.kind, 'web');
      assert.equal(renamed.revertible, true);
      const cleared = history.entries.find(
        (e) => e.type === 'system.updated' && e.diff.customName?.before === name,
      );
      assert.ok(cleared, 'and so is putting the name back');
      await other.close();
    });

    await check('two browsers on the map see each other through presence', async () => {
      const others = await browser.newContext();
      const second = await others.newPage();
      await second.goto(`${BASE}/m/${MAP}`);
      await second.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
      const mapId = await page.evaluate(
        async (base) => (await (await fetch(`${base}/api/maps/by-slug/demo-chain`)).json()).id,
        BASE,
      );
      // Each tab joins the map's presence over its own socket and shares a cursor.
      const join = (tab, cursor) =>
        tab.evaluate(
          ({ stream, cursor }) =>
            new Promise((resolve, reject) => {
              const ws = new globalThis.WebSocket(`${globalThis.location.origin.replace(/^http/, 'ws')}/ws`);
              globalThis.__presence = [];
              globalThis.__presenceSocket = ws;
              ws.onerror = () => reject(new Error('socket failed'));
              ws.onopen = () => ws.send(JSON.stringify({ op: 'subscribe', stream }));
              ws.onmessage = (message) => {
                const data = JSON.parse(message.data);
                if (data.op === 'subscribed') {
                  ws.send(JSON.stringify({ op: 'presence', stream, state: { cursor } }));
                  resolve();
                }
                if (data.op === 'presence') globalThis.__presence.push(data);
              };
            }),
          { stream: `map:${mapId}`, cursor },
        );
      const seen = (tab, cursor) =>
        tab.waitForFunction(
          (cursor) =>
            globalThis.__presence.some((m) =>
              m.peers.some((p) => p.cursor?.x === cursor.x && p.cursor?.y === cursor.y && p.name),
            ),
          cursor,
          { timeout: 10_000 },
        );
      await join(page, { x: 111, y: 222 });
      await join(second, { x: 333, y: 444 });
      await seen(page, { x: 333, y: 444 });
      await seen(second, { x: 111, y: 222 });
      // Closing one tab tells the other it left.
      await others.close();
      await page.waitForFunction(() => globalThis.__presence.some((m) => m.left.length > 0), null, {
        timeout: 10_000,
      });
      await page.evaluate(() => globalThis.__presenceSocket.close());
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
            // Settings open from the rail, never from the canvas.
            assert.equal(await page.locator('main').getByRole('link', { name: 'Map settings' }).count(), 0);
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
      await page.getByText('This device').first().waitFor();
      await page.goto(`${BASE}/maps`);
      await page.getByRole('heading', { name: 'All maps', exact: true }).waitFor();
      // The old settings address opens the map with the dialog over it.
      await page.goto(`${BASE}/m/${MAP}/settings?tab=notifications`);
      await page.getByRole('dialog', { name: 'Map settings' }).waitFor();
      assert.equal(new URL(page.url()).pathname, `/m/${MAP}`);
      await page.getByRole('tab', { name: 'Webhooks' }).click();
      await page.getByRole('heading', { name: 'Webhooks', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForTimeout(500);
      assert.deepEqual(errors, []);
    });
    await context.close();

    if (fake) await eveOnly(browser, fake);
  } finally {
    await browser.close();
    fake?.close();
  }

  console.log(process.exitCode ? 'smoke test failed' : `all ${checks.length} checks passed`);
}

/** An instance where Discord is not configured: EVE sign-in only, with a fake EVE behind it. */
async function eveOnly(browser, fake) {
  const { PILOT } = await import('./fake-eve.mjs');
  // The browser reaches the fake by the same names; its certificate is our own.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await check('an EVE-only instance signs in with EVE Online and nothing else', async () => {
      const providers = await (await fetch(`${EVE_BASE}/api/auth/providers`)).json();
      assert.equal(providers.loginMethod, 'eve');
      assert.equal(providers.discord, false);
      assert.equal(providers.demo, false);
      await page.goto(`${EVE_BASE}/login`);
      await page.getByRole('img', { name: 'Log in with EVE Online' }).waitFor();
      assert.equal(await page.getByText(/discord/i).count(), 0, 'no Discord on the sign-in page');
    });

    await check('signing in with EVE creates the account and opens the app', async () => {
      await page.getByRole('img', { name: 'Log in with EVE Online' }).click();
      const origin = new URL(EVE_BASE).origin;
      await page.waitForURL(
        (url) => url.origin === origin && !url.pathname.startsWith('/api/') && url.pathname !== '/login',
        { timeout: 15_000 },
      );
      assert.equal(new URL(page.url()).searchParams.get('auth_error'), null);
      const me = await (await context.request.get(`${EVE_BASE}/api/accounts/me`)).json();
      assert.equal(me.characters[0]?.name, PILOT.name);
      assert.equal(me.characters[0]?.canSearch, true);
      assert.equal(me.account.instanceRole, 'owner', 'the first account owns the instance');
      assert.ok(fake.calls.includes('POST login.eveonline.com/v2/oauth/token'));
    });

    await check('name pickers find corporations through ESI search', async () => {
      const api = context.request;
      const found = await (await api.get(`${EVE_BASE}/api/eve/search?category=corporation&q=Logist`)).json();
      assert.equal(found.mode, 'search');
      assert.deepEqual(
        found.results.map((r) => [r.name, r.ticker]),
        [
          ['Logistics Union', 'LOGU'],
          ['E2E Logistics', 'E2EL'],
        ],
      );
      // In the map's access settings, by typing part of the name.
      const created = await api.post(`${EVE_BASE}/api/maps`, { data: { name: 'Home', slug: 'home' } });
      assert.equal(created.status(), 201, await created.text());
      await page.goto(`${EVE_BASE}/m/home/settings?tab=access`);
      const picker = page
        .getByRole('combobox', { name: /corporation/i })
        .or(page.getByPlaceholder('Search a corporation by name'));
      await picker.first().fill('Logist');
      await page.getByRole('option', { name: /E2E Logistics/ }).waitFor({ timeout: 10_000 });
      await page.getByRole('option', { name: /Logistics Union/ }).waitFor();
      assert.ok(fake.calls.some((c) => /GET esi\.evetech\.net\/characters\/\d+\/search/.test(c)));
    });
  } finally {
    await context.close();
  }
}

await run();
