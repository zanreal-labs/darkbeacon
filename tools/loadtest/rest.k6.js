// REST load with k6 (grafana/k6, version pinned in run.sh): what 400 people with the map open do
// besides the WebSocket. Arrival rates per scenario, each request as a random seeded account.
//   k6 run -e BASE=http://app:3000 -e FIXTURE=/fixture/fixture.json rest.k6.js
/* global __ENV, open */
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE || 'http://app:3000';
const RATE = Number(__ENV.RATE || 1);
const DURATION = __ENV.DURATION || '2m';

const fixture = () => JSON.parse(open(__ENV.FIXTURE || '/fixture/fixture.json'));
const accounts = new SharedArray('accounts', () =>
  fixture()
    .accounts.slice(1)
    .map((a) => a.session),
);
const maps = new SharedArray('maps', () =>
  fixture().maps.map((m) => ({ id: m.id, slug: m.slug, systems: m.systems.slice(0, 300) })),
);

const scenario = (exec, rate, extra = {}) => ({
  executor: 'constant-arrival-rate',
  exec,
  rate: Math.max(1, Math.round(rate * RATE * 10)),
  timeUnit: '10s',
  duration: DURATION,
  preAllocatedVUs: 20,
  maxVUs: 200,
  ...extra,
});

export const options = {
  discardResponseBodies: true,
  scenarios: {
    reads: scenario('reads', 40),
    snapshot: scenario('snapshot', 2),
    edits: scenario('edits', 5),
    paste: scenario('paste', 0.5),
    page: scenario('page', 2),
  },
  thresholds: {
    'http_req_duration{kind:api}': ['p(95)<150'],
    'http_req_duration{kind:snapshot}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    // Always true; makes k6 report each endpoint on its own.
    ...Object.fromEntries(
      [
        'me',
        'maps',
        'landing',
        'characters',
        'preferences',
        'map',
        'signatures',
        'history',
        'move',
        'paste',
        'page',
      ].map((name) => [`http_req_duration{name:${name}}`, ['max>=0']]),
    ),
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const as = (kind, name) => ({
  headers: { cookie: `dbk_session=${pick(accounts)}`, 'content-type': 'application/json' },
  tags: { kind, name },
});

export function reads() {
  const map = pick(maps);
  const routes = [
    ['me', '/api/accounts/me'],
    ['maps', '/api/maps'],
    ['landing', '/api/accounts/me/landing'],
    ['characters', `/api/maps/${map.id}/characters`],
    ['preferences', `/api/maps/${map.id}/preferences`],
    ['map', `/api/maps/${map.id}`],
    ['signatures', `/api/maps/${map.id}/systems/${pick(map.systems)}/signatures`],
    ['history', `/api/maps/${map.id}/history?limit=50`],
  ];
  const [name, path] = pick(routes);
  const response = http.get(`${BASE}${path}`, as('api', name));
  check(response, { [`${name} ok`]: (r) => r.status === 200 });
}

export function snapshot() {
  // Mostly the big main map, where most people are.
  const map = Math.random() < 0.6 ? maps[0] : pick(maps);
  const response = http.get(`${BASE}/api/streams/map:${map.id}/snapshot`, as('snapshot', 'snapshot'));
  check(response, { 'snapshot ok': (r) => r.status === 200 });
}

export function edits() {
  const map = pick(maps.slice(1));
  const system = pick(map.systems);
  const body = JSON.stringify({
    position: { x: Math.round(Math.random() * 20000), y: Math.round(Math.random() * 20000) },
  });
  const response = http.patch(`${BASE}/api/maps/${map.id}/systems/${system}`, body, as('api', 'move'));
  check(response, { 'move ok': (r) => r.status === 200 });
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function paste() {
  const map = pick(maps.slice(1));
  const system = pick(map.systems);
  // A system is scanned again and again: the same signatures each time, a few new ones (5 %).
  const lines = [];
  for (let i = 0; i < 200; i++) {
    const seen = Math.random() >= 0.05;
    const third = seen ? LETTERS[(system + i) % 26] : pick(LETTERS);
    const digits = seen ? (system * 7 + i * 13) % 1000 : Math.floor(Math.random() * 1000);
    const id = `${LETTERS[i % 26]}${LETTERS[Math.floor(i / 26) % 26]}${third}-${String(digits).padStart(3, '0')}`;
    lines.push(
      i % 3 === 0
        ? `${id}\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.32 AU`
        : `${id}\tCosmic Signature\t\t\t${(Math.random() * 100).toFixed(1)}%\t${(Math.random() * 20).toFixed(2)} AU`,
    );
  }
  const response = http.post(
    `${BASE}/api/maps/${map.id}/systems/${system}/signatures/paste`,
    JSON.stringify({ text: lines.join('\n'), mode: 'merge' }),
    as('paste', 'paste'),
  );
  check(response, { 'paste ok': (r) => r.status === 200 });
}

export function page() {
  const map = Math.random() < 0.6 ? maps[0] : pick(maps);
  const response = http.get(`${BASE}/m/${map.slug}`, as('page', 'page'));
  check(response, { 'page ok': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const out = __ENV.OUT || '/out/rest-summary.json';
  return { [out]: JSON.stringify(data, null, 2), stdout: textSummary(data) };
}

function textSummary(data) {
  const lines = [];
  for (const [name, metric] of Object.entries(data.metrics)) {
    if (!name.startsWith('http_req_duration') && name !== 'http_req_failed' && name !== 'http_reqs') continue;
    const v = metric.values;
    lines.push(
      `${name.padEnd(48)} ${Object.entries(v)
        .map(([k, x]) => `${k}=${typeof x === 'number' ? x.toFixed(1) : x}`)
        .join(' ')}`,
    );
  }
  return lines.join('\n') + '\n';
}
