// Synthetic WebSocket clients: each signs in with a seeded session, opens a map as the web app
// does (snapshot over HTTP, then a socket resuming from its seq), and the ones on the main map
// move their cursor like a browser does (presence patches at CURSOR_HZ). One editor moves
// systems on the main map over REST. Measures:
//   - snapshot time and size, subscribe -> subscribed (replay) time,
//   - edit fan-out: REST request sent -> `system.updated` received by every client on the map,
//   - presence fan-out: cursor sent -> seen by the other clients,
//   - tracking: fake ESI jump -> `character.jumped` on the map,
//   - messages and bytes each client receives.
// Clients are spread over PROCS processes. Runs inside the loadtest image:
//   BASE=http://app:3000 FIXTURE=/fixture/fixture.json node ws-load.mjs
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const env = (name, fallback) => (process.env[name] === undefined ? fallback : Number(process.env[name]));
const BASE = process.env.BASE ?? 'http://app:3000';
const ESI = process.env.ESI ?? 'http://fake-esi:8080';
const config = {
  clients: env('CLIENTS', 400),
  /** Clients on the main map that move their cursor. */
  cursors: env('CURSORS', 150),
  cursorHz: env('CURSOR_HZ', 15),
  durationSeconds: env('DURATION_S', 120),
  /** System moves per second on the main map (REST), each one a marked event. */
  editsPerSecond: env('EDITS_PER_S', 2),
  /** Seconds over which clients connect (a page load each). */
  rampSeconds: env('RAMP_S', 20),
  procs: env('PROCS', 4),
};
const MOD = 10_000_000;
/** A timestamp hidden in a coordinate: now modulo MOD, decoded against the receiver's clock. */
const stamp = () => Date.now() % MOD;
const age = (value) => ((((Date.now() % MOD) - value) % MOD) + MOD) % MOD;

class Histogram {
  constructor(buckets = 20_000) {
    this.counts = new Array(buckets + 1).fill(0);
    this.n = 0;
    this.sum = 0;
    this.max = 0;
  }
  add(ms) {
    const v = Math.max(0, Math.round(ms));
    this.counts[Math.min(v, this.counts.length - 1)]++;
    this.n++;
    this.sum += v;
    if (v > this.max) this.max = v;
  }
  merge(other) {
    other.counts.forEach((c, i) => (this.counts[i] += c));
    this.n += other.n;
    this.sum += other.sum;
    this.max = Math.max(this.max, other.max);
  }
  quantile(q) {
    if (this.n === 0) return null;
    let seen = 0;
    const target = q * this.n;
    for (let i = 0; i < this.counts.length; i++) {
      seen += this.counts[i];
      if (seen >= target) return i;
    }
    return this.counts.length - 1;
  }
  summary() {
    return {
      n: this.n,
      mean: this.n ? Math.round(this.sum / this.n) : null,
      p50: this.quantile(0.5),
      p95: this.quantile(0.95),
      p99: this.quantile(0.99),
      max: this.max,
    };
  }
  static from(raw) {
    return Object.assign(new Histogram(raw.counts.length - 1), raw);
  }
}

const fixture = JSON.parse(readFileSync(process.env.FIXTURE ?? '/fixture/fixture.json', 'utf8'));
const main = fixture.maps[0];

// ---- worker: a slice of the clients
async function worker(index) {
  const metrics = {
    connected: 0,
    failed: 0,
    closed: 0,
    errors: 0,
    messages: 0,
    bytes: 0,
    snapshotBytes: new Histogram(),
    pageSnapshot: new Histogram(),
    subscribe: new Histogram(),
    edit: new Histogram(),
    presence: new Histogram(),
    jumpSeen: [],
  };
  const sockets = [];
  const mine = [];
  for (let i = index; i < config.clients; i += config.procs) mine.push(i);
  const stopAt = Date.now() + config.durationSeconds * 1000;
  const ramp = (config.rampSeconds * 1000) / Math.max(1, mine.length);

  // As a browser opening the map: the page brings the snapshot (read over HTTP by the web
  // server), then the socket resumes from its seq with a replay.
  const open = async (i) => {
    const account = fixture.accounts[1 + (i % (fixture.accounts.length - 1))];
    const onMain = i < config.cursors || i % 3 === 0;
    const map = onMain ? main : fixture.maps[1 + (i % (fixture.maps.length - 1))];
    const stream = `map:${map.id}`;
    const cookie = `dbk_session=${account.session}`;
    let sinceSeq;
    try {
      const started = Date.now();
      const response = await fetch(`${BASE}/api/streams/${stream}/snapshot`, { headers: { cookie } });
      const body = await response.arrayBuffer();
      metrics.pageSnapshot.add(Date.now() - started);
      metrics.snapshotBytes.add(body.byteLength / 1024);
      sinceSeq = JSON.parse(Buffer.from(body).toString()).seq;
    } catch {
      metrics.failed++;
      return;
    }
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`, { headers: { cookie } });
    sockets.push(ws);
    let subscribedAt = 0;
    let cursorTimer = null;
    ws.on('open', () => {
      metrics.connected++;
      subscribedAt = Date.now();
      ws.send(JSON.stringify({ op: 'subscribe', stream, sinceSeq }));
    });
    ws.on('message', (data) => {
      metrics.messages++;
      metrics.bytes += data.length;
      const message = JSON.parse(data.toString());
      if (message.op === 'snapshot') {
        metrics.snapshotBytes.add(data.length / 1024);
      } else if (message.op === 'subscribed') {
        metrics.subscribe.add(Date.now() - subscribedAt);
        if (i < config.cursors) {
          let y = Math.random() * 2000;
          cursorTimer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            y += (Math.random() - 0.5) * 40;
            ws.send(JSON.stringify({ op: 'presence', stream, state: { cursor: { x: stamp(), y } } }));
          }, 1000 / config.cursorHz);
        }
      } else if (message.op === 'event') {
        const { event } = message;
        if (event.type === 'system.updated' && event.data.position?.y < 0 && event.data.position.x >= 0)
          metrics.edit.add(age(event.data.position.x));
        else if (event.type === 'character.jumped')
          metrics.jumpSeen.push([event.id, event.data.characterId, event.data.to, Date.now()]);
      } else if (message.op === 'presence' && !message.full) {
        for (const peer of message.peers) if (peer.cursor) metrics.presence.add(age(peer.cursor.x));
      } else if (message.op === 'error') {
        metrics.errors++;
      }
    });
    ws.on('error', () => metrics.failed++);
    ws.on('close', () => {
      metrics.closed++;
      clearInterval(cursorTimer);
    });
  };

  mine.forEach((i, n) => setTimeout(() => void open(i), n * ramp));
  await new Promise((resolve) => setTimeout(resolve, stopAt - Date.now()));
  for (const ws of sockets) ws.terminate();
  // Each jump event once (many clients see it), when it first arrived.
  const seen = new Map();
  for (const [id, c, s, at] of metrics.jumpSeen) {
    if (!seen.has(id) || seen.get(id)[2] > at) seen.set(id, [c, s, at]);
  }
  metrics.jumpSeen = [...seen];
  return metrics;
}

// ---- the editor: marked system moves on the main map
async function editor(stopAt) {
  const account = fixture.accounts[0];
  const rest = new Histogram();
  let failures = 0;
  const targets = main.systems.slice(1, 200);
  let n = 0;
  while (Date.now() < stopAt) {
    const system = targets[n++ % targets.length];
    const started = Date.now();
    try {
      const response = await fetch(`${BASE}/api/maps/${main.id}/systems/${system}`, {
        method: 'PATCH',
        headers: { cookie: `dbk_session=${account.session}`, 'content-type': 'application/json' },
        body: JSON.stringify({ position: { x: stamp(), y: -n } }),
      });
      await response.arrayBuffer();
      if (!response.ok) failures++;
      rest.add(Date.now() - started);
    } catch {
      failures++;
    }
    const wait = 1000 / config.editsPerSecond - (Date.now() - started);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return { rest: rest.summary(), failures };
}

// ---- the run: forks the workers, runs the editor, merges and reports
async function run() {
  const started = Date.now();
  await fetch(`${ESI}/_reset`, { method: 'POST' }).catch(() => {});
  const results = await Promise.all([
    ...Array.from(
      { length: config.procs },
      (_, i) =>
        new Promise((resolve, reject) => {
          const child = fork(new URL(import.meta.url).pathname, {
            env: { ...process.env, WS_WORKER: String(i) },
          });
          let result = null;
          child.on('message', (text) => (result = JSON.parse(text)));
          child.on('exit', (code) =>
            result ? resolve(result) : reject(new Error(`worker ${i} exited ${code}`)),
          );
        }),
    ),
    // Edits start once clients are connected.
    new Promise((resolve) => setTimeout(resolve, config.rampSeconds * 1000)).then(() =>
      editor(started + config.durationSeconds * 1000 - 2000),
    ),
  ]);
  const edits = results.pop();
  const total = {
    connected: 0,
    failed: 0,
    closed: 0,
    errors: 0,
    messages: 0,
    bytes: 0,
  };
  const histograms = ['snapshotBytes', 'pageSnapshot', 'subscribe', 'edit', 'presence'];
  const merged = Object.fromEntries(histograms.map((h) => [h, new Histogram()]));
  const firstSeen = new Map();
  for (const r of results) {
    for (const key of Object.keys(total)) total[key] += r[key];
    for (const h of histograms) merged[h].merge(Histogram.from(r[h]));
    for (const [id, entry] of r.jumpSeen)
      if (!firstSeen.has(id) || firstSeen.get(id)[2] > entry[2]) firstSeen.set(id, entry);
  }
  /** `${character}:${system}` -> when jumps there were seen, in order. */
  const jumpSeen = new Map();
  for (const [c, s, at] of firstSeen.values()) {
    const key = `${c}:${s}`;
    jumpSeen.set(
      key,
      [...(jumpSeen.get(key) ?? []), at].sort((a, b) => a - b),
    );
  }

  // Jumps on the main map that a client saw: how long after the fake ESI made them.
  const jumps = await fetch(`${ESI}/_jumps?since=${started}`)
    .then((r) => r.json())
    .catch(() => []);
  const esi = await fetch(`${ESI}/_stats`)
    .then((r) => r.json())
    .catch(() => null);
  const onMain = new Set(
    fixture.tracking.filter((t) => t.mapIds.includes(main.id)).map((t) => t.characterId),
  );
  // A jump counts when the map saw the character arrive before it jumped on; a character that
  // jumps again within one poll is seen where it ended up (the system between is "passed").
  const jumpLatency = new Histogram(60_000);
  let missed = 0;
  let passed = 0;
  const byCharacter = new Map();
  for (const j of jumps) {
    if (!onMain.has(j.characterId)) continue;
    byCharacter.set(j.characterId, [...(byCharacter.get(j.characterId) ?? []), j]);
  }
  for (const list of byCharacter.values()) {
    list.forEach((j, i) => {
      const next = list[i + 1]?.at ?? Infinity;
      const at = (jumpSeen.get(`${j.characterId}:${j.to}`) ?? []).find((t) => t >= j.at);
      if (at !== undefined && at <= next) jumpLatency.add(at - j.at);
      else if (next - j.at < 6_000) passed++;
      else missed++;
    });
  }

  const seconds = config.durationSeconds;
  const report = {
    config,
    clients: total,
    perClient: {
      messagesPerSecond: total.messages / Math.max(1, total.connected) / seconds,
      kbPerSecond: total.bytes / 1024 / Math.max(1, total.connected) / seconds,
    },
    snapshotKb: merged.snapshotBytes.summary(),
    pageSnapshotMs: merged.pageSnapshot.summary(),
    subscribeMs: merged.subscribe.summary(),
    editFanoutMs: merged.edit.summary(),
    editRest: edits,
    presenceFanoutMs: merged.presence.summary(),
    jumpToMapMs: { ...jumpLatency.summary(), passed, missed },
    esi,
  };
  const text = JSON.stringify(report, null, 2);
  if (process.env.OUT) writeFileSync(process.env.OUT, text);
  console.log(text);
}

if (process.env.WS_WORKER !== undefined) {
  const metrics = await worker(Number(process.env.WS_WORKER));
  process.send(JSON.stringify(metrics), () => process.exit(0));
} else {
  await run();
}
