// End-to-end check of the Wanderer import against a running demo instance and the fake Wanderer
// (tools/fake-wanderer): allow private networks, test the connection, read the map, look at the
// preview, import into a new map that keeps syncing, follow the job, open the map, look at the
// sync in the map's settings. Screenshots go to OUT.
//
// Runs inside the Playwright image, never on the host (see tools/e2e/README.md):
//   BASE=http://<demo instance> WANDERER=http://<fake wanderer>:4010 OUT=/out node import-wanderer.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://app:3000';
const WANDERER = process.env.WANDERER ?? 'http://wanderer:4010';
const KEY = process.env.WANDERER_KEY ?? 'wanderer-map-key-0123456789';
const OUT = process.env.OUT ?? '/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
page.on(
  'console',
  (message) => message.type() === 'error' && errors.push(`${page.url()}: ${message.text()}`),
);

/** The page scrolls inside the shell's <main>; a full-page shot lets it grow first. */
async function shot(name, options = {}) {
  const grow = async (on) =>
    page.evaluate((on) => {
      const main = globalThis.document.getElementById('main');
      if (!main?.parentElement) return;
      main.style.overflow = on ? 'visible' : '';
      main.parentElement.style.height = on ? 'auto' : '';
      main.parentElement.style.minHeight = on ? '100dvh' : '';
    }, on);
  if (options.fullPage) await grow(true);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
  if (options.fullPage) await grow(false);
}
const step = (name) => console.log(`  ${name}`);

console.log(`import from ${WANDERER} into ${BASE}`);

step('signs in as the demo pilot and allows imports from private networks');
await page.goto(`${BASE}/admin?tab=instance`, { waitUntil: 'networkidle' });
const allow = page.getByRole('switch', { name: 'Allow imports from private networks' });
await allow.waitFor();
if ((await allow.getAttribute('aria-checked')) !== 'true') await allow.click();
await page.getByRole('switch', { name: 'Allow imports from private networks', checked: true }).waitFor();
await shot('01-admin-imports');

step('All maps has "Import from Wanderer"');
await page.goto(`${BASE}/maps`, { waitUntil: 'networkidle' });
await shot('02-all-maps');
await page.getByRole('link', { name: 'Import from Wanderer' }).first().click();
await page.waitForURL(/\/import$/);
await page.waitForLoadState('networkidle');

step('tests the connection');
await page.getByRole('textbox', { name: 'Wanderer address' }).fill(WANDERER);
await page.getByRole('textbox', { name: 'Map', exact: true }).fill('home-chain');
await page.getByLabel('Map API key').fill(KEY);
await page.getByRole('button', { name: 'Test connection' }).click();
await page.getByText(/Connected: 30 systems/).waitFor({ timeout: 30_000 });
await shot('03-source-tested');

step('reads the map into a preview');
await page.getByRole('button', { name: 'Read map' }).click();
await page
  .getByRole('region', { name: 'Preview' })
  .or(page.locator('[aria-label="Preview"]'))
  .first()
  .waitFor({ timeout: 60_000 });
await page.getByText('Who gets access').waitFor();
await page.getByLabel('What the import does').waitFor({ timeout: 30_000 });
const counts = await page.locator('[aria-label="Preview"] dd').allInnerTexts();
assert.equal(counts[0], '28', `visible systems: ${counts.join(', ')}`);
await shot('04-preview', { fullPage: true });

step('imports into a new map that keeps syncing');
await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Home Chain');
await page.getByRole('checkbox', { name: 'Keep syncing from Wanderer' }).click();
await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.getByText('Imported', { exact: true }).waitFor({ timeout: 120_000 });
const progress = await page.getByRole('progressbar').getAttribute('aria-valuenow');
assert.equal(progress, '100');
await shot('05-imported', { fullPage: true });

step('opens the map');
await page.getByRole('link', { name: 'Open map' }).click();
await page.waitForURL(/\/m\/home-chain/);
await page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
const nodes = await page.locator('.react-flow__node').count();
assert.ok(nodes >= 20, `nodes on the map: ${nodes}`);
await shot('06-map');
await page.keyboard.press('f');
await page.waitForTimeout(800);
await shot('07-map-fit');

step('every kind of intel came over: anomalies, custom entries, locks, notes, lifetimes, passages');
const id = await mapId();
const snapshot = await (
  await page.request.get(`${BASE}/api/streams/${encodeURIComponent(`map:${id}`)}/snapshot`)
).json();
const { connections, signatures } = snapshot.data;
// Wanderer's labels are the map's Labels, its tags Tags; Darkbeacon's own tag stays empty.
assert.deepEqual(
  snapshot.data.map.systemLabels.map((l) => l.name),
  ['A', 'B', '1', 'Exit'],
);
assert.deepEqual(snapshot.data.map.labels.map((l) => l.name).sort(), [
  'FARM',
  'HQ',
  'Looking for',
  'Secondary',
]);
const home = snapshot.data.systems.find((s) => s.solarSystemId === 31002531);
assert.deepEqual(home.systemLabelIds, ['a', '1']);
assert.equal(home.customLabel, 'Staging');
assert.ok(
  snapshot.data.systems.every((s) => s.tag === null),
  'no tag written',
);
assert.ok(
  signatures.some((x) => x.kind === 'anomaly'),
  'anomalies',
);
assert.ok(
  signatures.some((x) => x.kind === 'other'),
  'other scanner rows',
);
assert.ok(
  signatures.some((x) => x.custom && x.eveId === 'TOWER-1'),
  'custom entries',
);
assert.ok(
  connections.some((c) => c.locked),
  'a locked connection',
);
assert.ok(
  connections.some((c) => c.note),
  'connection notes',
);
for (const mark of ['1h', '4h', '4.5h', '16h', '24h', '48h'])
  assert.ok(
    connections.some((c) => c.lifetime?.mark === mark),
    `lifetime ${mark}`,
  );
let passages = 0;
for (const c of connections)
  passages += (await (await page.request.get(`${BASE}/api/maps/${id}/connections/${c.id}/passages`)).json())
    .length;
assert.equal(passages, 5, 'passages');

step('the sidebar shows connections with their padlock and the anomalies fold');
await page.locator('.react-flow__node', { hasText: 'Farm' }).first().click();
await page.getByRole('region', { name: 'Connections' }).waitFor({ timeout: 15_000 });
await page.getByRole('button', { name: /Anomalies and other results/ }).click();
await page.waitForTimeout(400);
await shot('07b-sidebar-farm');
// The locked hole (Thera to EC-P8R): select its far end once the sidebar is closed and the chain fits.
await page.keyboard.press('Escape');
await page.keyboard.press('f');
await page.waitForTimeout(800);
await page.locator('.react-flow__node', { hasText: 'EC-P8R' }).first().click();
await page
  .getByRole('region', { name: 'Connections' })
  .getByRole('button', { name: /Unlock the connection/ })
  .waitFor({ timeout: 15_000 });
await shot('07c-sidebar-locked-connection');

step('the map settings show the sync');
await page.goto(`${BASE}/m/home-chain?settings=import`, { waitUntil: 'networkidle' });
await page.getByText('Syncing from Wanderer').waitFor({ timeout: 15_000 });
await shot('08-settings-import');

step("the description, the users' hubs and the webhooks (switched off) came over");
await page.goto(`${BASE}/m/home-chain?settings=general`, { waitUntil: 'networkidle' });
assert.equal(await page.getByRole('textbox', { name: 'Description' }).inputValue(), 'Our main chain');
const hubs = await (await page.request.get(`${BASE}/api/maps/${await mapId()}/hubs`)).json();
assert.deepEqual(
  hubs.map.map((h) => h.solarSystemId),
  [30000142, 30002187, 30002659],
);
await page.goto(`${BASE}/m/home-chain?settings=webhooks`, { waitUntil: 'networkidle' });
await page.getByText('https://bots.example.org/darkbeacon', { exact: true }).waitFor({ timeout: 15_000 });
const switches = page.getByRole('switch');
assert.equal(await switches.count(), 2, 'two imported webhooks');
for (let i = 0; i < 2; i++) assert.equal(await switches.nth(i).getAttribute('aria-checked'), 'false');
await shot('08b-settings-webhooks');
await page.getByRole('button', { name: 'New signing secret' }).first().click();
await page.getByText('New signing secret. Copy it now').waitFor({ timeout: 15_000 });
await shot('08c-webhook-new-secret');
await page.goto(`${BASE}/maps`, { waitUntil: 'networkidle' });
await page.getByText('Our main chain').waitFor({ timeout: 15_000 });
await shot('08d-all-maps-description');

step('history names the source');
const history = await page.request.get(`${BASE}/api/maps/${await mapId()}/history?types=import.*`);
const entries = (await history.json()).entries;
assert.ok(
  entries.some((e) => e.type === 'import.finished'),
  'import.finished in the history',
);

step('phone and dark mode');
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
await shot('09-import-phone-dark', { fullPage: true });
await page.goto(`${BASE}/m/home-chain`, { waitUntil: 'networkidle' });
await page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
await shot('10-map-phone-dark');

await browser.close();
const relevant = errors.filter(
  (e) => !/favicon|images\.evetech\.net|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e),
);
assert.deepEqual(relevant, [], `page errors: ${relevant.join('\n')}`);
console.log(`done, screenshots in ${OUT}`);

async function mapId() {
  const maps = await (await page.request.get(`${BASE}/api/maps`)).json();
  return maps.find((m) => m.slug === 'home-chain').id;
}
