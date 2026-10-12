// Map snapshot timing with nothing else going on: GET /api/streams/map:<id>/snapshot of the main
// (biggest) map, one request at a time, as a page load does. Runs inside the loadtest image.
//   BASE=http://app:3000 FIXTURE=/fixture/fixture.json node snapshot-bench.mjs
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://app:3000';
const RUNS = Number(process.env.RUNS ?? 40);
const fixture = JSON.parse(readFileSync(process.env.FIXTURE ?? '/fixture/fixture.json', 'utf8'));
const map = fixture.maps[0];
const cookie = `dbk_session=${fixture.accounts[1].session}`;

async function once(encoding) {
  const started = performance.now();
  const response = await fetch(`${BASE}/api/streams/map:${map.id}/snapshot`, {
    headers: { cookie, 'accept-encoding': encoding },
  });
  const body = await response.arrayBuffer();
  if (!response.ok) throw new Error(`snapshot answered ${response.status}`);
  return {
    ms: performance.now() - started,
    wireKb: Number(response.headers.get('content-length') ?? body.byteLength) / 1024,
    encoding: response.headers.get('content-encoding') ?? 'identity',
  };
}

const summarize = (runs) => {
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]);
  return {
    runs: runs.length,
    p50: q(0.5),
    p95: q(0.95),
    max: Math.round(ms.at(-1)),
    wireKb: Math.round(runs[0].wireKb),
    encoding: runs[0].encoding,
  };
};

const report = { systems: map.systems.length, connections: map.edges.length };
for (const encoding of ['identity', 'gzip, br']) {
  await once(encoding); // warm up
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(encoding));
  report[encoding === 'identity' ? 'plain' : 'compressed'] = summarize(runs);
}
console.log(JSON.stringify(report, null, 2));
