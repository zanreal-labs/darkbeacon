// A fake ESI for load tests: the three tracking routes (location, ship, online) with the rules the
// real ESI applies (https://developers.eveonline.com/docs/services/esi/rate-limiting/ and
// /docs/services/esi/best-practices/): responses cached per route (5 s, 5 s, 60 s) with Expires,
// Cache-Control and ETag, 304 for a matching If-None-Match, a floating-window token bucket per
// character in the `char-location` group (1200 tokens / 15 min; 2xx costs 2, 3xx 1, 4xx 5, 5xx 0)
// with X-Ratelimit-* headers and 429 + Retry-After, and the global error limit (100 errors a
// minute, then 420 for everything). Characters walk the seeded chains, with bursts of fleet jumps.
//
// Never point a load test at the real ESI. Runs inside the loadtest image:
//   FIXTURE=/fixture/fixture.json node fake-esi.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const env = (name, fallback) => (process.env[name] === undefined ? fallback : Number(process.env[name]));
const config = {
  port: env('PORT', 8080),
  /** Response time: base plus a uniform random share. */
  latencyMs: env('LATENCY_MS', 30),
  latencyJitterMs: env('LATENCY_JITTER_MS', 90),
  /** Share of requests answered with a 5xx (ESI has bad minutes). */
  errorRate: env('ERROR_RATE', 0.0005),
  /** Mean seconds between two jumps of one online character. */
  jumpEverySeconds: env('JUMP_EVERY_S', 120),
  /** Every this many seconds a fleet of BURST_SIZE online characters jumps at once (0: never). */
  burstEverySeconds: env('BURST_EVERY_S', 30),
  burstSize: env('BURST_SIZE', 250),
  /** Share of jumps into a system that is not on the map yet (auto-mapping adds it). */
  newSystemRate: env('NEW_SYSTEM_RATE', 0.05),
  bucketTokens: env('BUCKET_TOKENS', 1200),
  bucketWindowSeconds: env('BUCKET_WINDOW_S', 900),
  errorLimit: env('ERROR_LIMIT', 100),
  errorWindowSeconds: env('ERROR_WINDOW_S', 60),
};
const TTL = { location: 5, ship: 5, online: 60 };
const COST = { ok: 2, notModified: 1, clientError: 5, serverError: 0 };
const GROUP = 'char-location';

const fixture = JSON.parse(readFileSync(process.env.FIXTURE ?? '/fixture/fixture.json', 'utf8'));
const adjacency = new Map();
for (const map of fixture.maps) {
  const edges = new Map();
  for (const [a, b] of map.edges) {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a).push(b);
    edges.get(b).push(a);
  }
  adjacency.set(map.id, edges);
}
/** Wormhole systems to jump into when a jump finds a new hole. */
const spare = fixture.spareSystems ?? [];

const characters = new Map();
for (const t of fixture.tracking) {
  characters.set(t.characterId, {
    id: t.characterId,
    mapId: t.mapIds[0],
    system: t.systemId,
    online: t.online,
    shipTypeId: 11182,
    lastLogin: Date.now() - 3_600_000,
  });
}
const online = () => [...characters.values()].filter((c) => c.online);

const stats = newStats();
function newStats() {
  return {
    startedAt: Date.now(),
    requests: 0,
    byRoute: {},
    byStatus: {},
    /** Requests for a route while the previous answer was still fresh (the client ignored Expires). */
    early: 0,
    tooMany: 0,
    errorLimited: 0,
    jumps: 0,
    peakTokensUsed: 0,
    inflight: 0,
    peakInflight: 0,
    perSecond: new Map(),
  };
}
/** Jump log, for the harness to measure how long a jump takes to reach the map. */
let jumps = [];

// ---- the simulation
function jump(c, now) {
  const edges = adjacency.get(c.mapId);
  const next = edges?.get(c.system);
  let to;
  if ((Math.random() < config.newSystemRate || !next?.length) && spare.length > 0) {
    to = spare[Math.floor(Math.random() * spare.length)];
    // Remember the hole so the character can come back the same way.
    if (edges) {
      if (!edges.has(to)) edges.set(to, []);
      edges.get(to).push(c.system);
      edges.get(c.system)?.push(to);
    }
  } else if (next?.length) {
    to = next[Math.floor(Math.random() * next.length)];
  } else return;
  jumps.push({ characterId: c.id, from: c.system, to, at: now });
  c.system = to;
  stats.jumps++;
}

setInterval(() => {
  const now = Date.now();
  const p = 1 / config.jumpEverySeconds;
  for (const c of characters.values()) if (c.online && Math.random() < p) jump(c, now);
}, 1000).unref();

if (config.burstEverySeconds > 0) {
  setInterval(() => {
    const now = Date.now();
    const pool = online();
    for (let i = 0; i < config.burstSize && pool.length > 0; i++) {
      const [c] = pool.splice(Math.floor(Math.random() * pool.length), 1);
      jump(c, now);
    }
  }, config.burstEverySeconds * 1000).unref();
}

// ---- ESI rules
/** characterId -> [{ at, cost }] spent in the current floating window. */
const buckets = new Map();
function spent(characterId, now) {
  const list = buckets.get(characterId) ?? [];
  const from = now - config.bucketWindowSeconds * 1000;
  while (list.length > 0 && list[0].at <= from) list.shift();
  buckets.set(characterId, list);
  return list;
}
function remaining(characterId, now) {
  return config.bucketTokens - spent(characterId, now).reduce((sum, s) => sum + s.cost, 0);
}
function spend(characterId, now, cost) {
  if (cost > 0) spent(characterId, now).push({ at: now, cost });
  stats.peakTokensUsed = Math.max(stats.peakTokensUsed, config.bucketTokens - remaining(characterId, now));
}

let errorWindow = { resetAt: 0, errors: 0 };
function errorState(now) {
  if (now >= errorWindow.resetAt)
    errorWindow = { resetAt: now + config.errorWindowSeconds * 1000, errors: 0 };
  return errorWindow;
}

/** `${characterId}:${route}` -> the answer ESI keeps until it expires. */
const cache = new Map();
function body(c, route) {
  if (route === 'location') return { solar_system_id: c.system };
  if (route === 'ship')
    return { ship_type_id: c.shipTypeId, ship_item_id: 1_000_000_000_000 + c.id, ship_name: 'Probe' };
  return { online: c.online, last_login: new Date(c.lastLogin).toISOString(), logins: 10 };
}
function cached(c, route, now) {
  const key = `${c.id}:${route}`;
  let entry = cache.get(key);
  const fresh = entry && entry.expiresAt > now;
  if (!fresh) {
    const text = JSON.stringify(body(c, route));
    const etag = `"${createHash('sha1').update(text).digest('hex').slice(0, 16)}"`;
    entry = { text, etag, expiresAt: now + TTL[route] * 1000, lastModified: now };
    cache.set(key, entry);
  }
  return { entry, fresh };
}

function send(res, status, headers, text) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

/** Time between two location requests of one character: how fresh tracking is. */
const lastLocation = new Map();
let locationGaps = [];
function count(route, status, now, characterId) {
  if (route === 'location' && characterId !== undefined) {
    const last = lastLocation.get(characterId);
    if (last !== undefined) locationGaps.push(now - last);
    if (locationGaps.length > 50_000) locationGaps = locationGaps.slice(-25_000);
    lastLocation.set(characterId, now);
  }
  stats.requests++;
  stats.byRoute[route] = (stats.byRoute[route] ?? 0) + 1;
  stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1;
  const second = Math.floor(now / 1000);
  stats.perSecond.set(second, (stats.perSecond.get(second) ?? 0) + 1);
  if (stats.perSecond.size > 600) stats.perSecond.delete(stats.perSecond.keys().next().value);
}

function handleEsi(req, res, route, characterId) {
  const now = Date.now();
  const errors = errorState(now);
  const errorHeaders = {
    'x-esi-error-limit-remain': String(Math.max(0, config.errorLimit - errors.errors)),
    'x-esi-error-limit-reset': String(Math.ceil((errors.resetAt - now) / 1000)),
  };
  if (errors.errors >= config.errorLimit) {
    stats.errorLimited++;
    count(route, 420, now);
    return send(res, 420, errorHeaders, '{"error":"This software has exceeded the error limit for ESI."}');
  }
  const date = new Date(now).toUTCString();
  const limitHeaders = (used) => ({
    'x-ratelimit-group': GROUP,
    'x-ratelimit-limit': `${config.bucketTokens}/${config.bucketWindowSeconds / 60}m`,
    'x-ratelimit-remaining': String(Math.max(0, remaining(characterId, now))),
    'x-ratelimit-used': String(used),
  });
  const fail = (status, cost, text) => {
    if (status !== 429) errors.errors++;
    spend(characterId, now, cost);
    count(route, status, now, characterId);
    send(res, status, { date, ...limitHeaders(cost) }, text);
  };

  const c = characters.get(characterId);
  const auth = req.headers.authorization ?? '';
  if (!c) return fail(404, COST.clientError, '{"error":"Character not found"}');
  if (auth !== `Bearer fake:${characterId}`)
    return fail(403, COST.clientError, '{"error":"token not valid"}');

  const left = remaining(characterId, now);
  if (left < COST.ok) {
    const list = spent(characterId, now);
    const retry = Math.max(1, Math.ceil((list[0].at + config.bucketWindowSeconds * 1000 - now) / 1000));
    stats.tooMany++;
    count(route, 429, now, characterId);
    return send(
      res,
      429,
      { date, 'retry-after': String(retry), ...limitHeaders(0) },
      '{"error":"Too many requests"}',
    );
  }
  if (Math.random() < config.errorRate)
    return fail(503, COST.serverError, '{"error":"The datasource tranquility is temporarily unavailable"}');

  const { entry, fresh } = cached(c, route, now);
  // Expires has whole seconds; only count requests clearly before it.
  if (fresh && entry.expiresAt - now > 1000) stats.early++;
  const headers = {
    date,
    expires: new Date(entry.expiresAt).toUTCString(),
    'cache-control': `private, max-age=${Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))}`,
    'last-modified': new Date(entry.lastModified).toUTCString(),
    etag: entry.etag,
  };
  if (req.headers['if-none-match'] === entry.etag) {
    spend(characterId, now, COST.notModified);
    count(route, 304, now, characterId);
    res.writeHead(304, { ...headers, ...limitHeaders(COST.notModified) });
    return res.end();
  }
  spend(characterId, now, COST.ok);
  count(route, 200, now, characterId);
  send(res, 200, { ...headers, ...limitHeaders(COST.ok) }, entry.text);
}

function snapshotStats() {
  const now = Math.floor(Date.now() / 1000);
  const recent = [];
  for (let s = now - 60; s < now; s++) recent.push(stats.perSecond.get(s) ?? 0);
  const { perSecond: _, ...rest } = stats;
  return {
    ...rest,
    uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000),
    onlineCharacters: online().length,
    rpsLast60s: recent.reduce((a, b) => a + b, 0) / 60,
    locationEveryMs: quantiles(locationGaps),
    peakRps: Math.max(0, ...stats.perSecond.values()),
  };
}

function quantiles(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: sorted.length, p50: q(0.5), p95: q(0.95), max: sorted.at(-1) };
}

const ROUTE = /^\/characters\/(\d+)\/(location|ship|online)\/?$/;
createServer((req, res) => {
  const url = new URL(req.url, 'http://fake-esi');
  if (url.pathname === '/_stats') return send(res, 200, {}, JSON.stringify(snapshotStats()));
  if (url.pathname === '/_jumps') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return send(res, 200, {}, JSON.stringify(jumps.filter((j) => j.at >= since)));
  }
  if (url.pathname === '/_reset' && req.method === 'POST') {
    Object.assign(stats, newStats());
    jumps = [];
    locationGaps = [];
    return send(res, 200, {}, '{}');
  }
  if (url.pathname === '/_control' && req.method === 'POST') {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      Object.assign(config, JSON.parse(text || '{}'));
      send(res, 200, {}, JSON.stringify(config));
    });
    return;
  }
  const match = ROUTE.exec(url.pathname);
  if (!match || req.method !== 'GET') return send(res, 404, {}, '{"error":"Not found"}');
  stats.inflight++;
  stats.peakInflight = Math.max(stats.peakInflight, stats.inflight);
  const delay = config.latencyMs + Math.random() * config.latencyJitterMs;
  setTimeout(() => {
    stats.inflight--;
    try {
      handleEsi(req, res, match[2], Number(match[1]));
    } catch (error) {
      send(res, 500, {}, JSON.stringify({ error: String(error) }));
    }
  }, delay);
}).listen(config.port, () => {
  console.log(`fake ESI on :${config.port}, ${characters.size} characters, ${online().length} online`);
});
