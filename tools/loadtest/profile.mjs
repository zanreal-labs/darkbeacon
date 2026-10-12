// Preloaded into the app under load (`node --import /loadtest/profile.mjs ...`): profiles the CPU
// from the start and writes the profile on SIGWINCH, then starts a new one, so a run captures the
// steady state instead of startup. Not SIGUSR2: Nest shuts the app down on it. With
// HEAP_SNAPSHOT=1 a heap snapshot is written as well. Files land in PROFILE_DIR (default
// /out/prof); open .cpuprofile files in Chrome DevTools or speedscope.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeHeapSnapshot } from 'node:v8';

const dir = process.env.PROFILE_DIR ?? '/out/prof';
mkdirSync(dir, { recursive: true });
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 500 });
await session.post('Profiler.start');

let n = 0;
let busy = Promise.resolve();
// Signals are handled one after the other; a failure is logged, never fatal for the app.
process.on('SIGWINCH', () => {
  busy = busy
    .then(async () => {
      const name = `${dir}/cpu-${process.pid}-${++n}`;
      const { profile } = await session.post('Profiler.stop');
      writeFileSync(`${name}.cpuprofile`, JSON.stringify(profile));
      if (process.env.HEAP_SNAPSHOT === '1')
        writeHeapSnapshot(`${dir}/heap-${process.pid}-${n}.heapsnapshot`);
      console.log(`profile written: ${name}`);
    })
    .catch((error) => console.error('profile failed', error))
    .finally(() => session.post('Profiler.start').catch(() => {}));
});

// Event-loop delay and memory every 10 s: long synchronous work shows here before it shows in
// latencies, and the memory split tells a JavaScript leak (heap) from native memory (rss alone).
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
setInterval(() => {
  const ms = (ns) => Math.round(ns / 1e6);
  const mb = (bytes) => Math.round(bytes / 1048576);
  const memory = process.memoryUsage();
  console.log(
    `event loop delay pid=${process.pid} p50=${ms(delay.percentile(50))} p99=${ms(delay.percentile(99))} max=${ms(delay.max)} ms` +
      ` memory rss=${mb(memory.rss)} heap=${mb(memory.heapUsed)}/${mb(memory.heapTotal)} external=${mb(memory.external)} buffers=${mb(memory.arrayBuffers)} MB`,
  );
  delay.reset();
}, 10_000).unref();
