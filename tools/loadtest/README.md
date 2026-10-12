# Load harness

Proves the supported envelope in [`docs/scaling.md`](../../docs/scaling.md): an alliance on one instance,
against the production image, on SQLite or Postgres. Everything runs in containers on a private Docker
network with no way out, so the only ESI the app can reach is the fake one. Never point a load test at the
real ESI.

```sh
docker build -t darkbeacon:perf .
tools/loadtest/run.sh                                # SQLite, full scenario, 120 s
DB=postgres DURATION_S=300 tools/loadtest/run.sh     # Postgres 17
SCENARIO=snapshot tools/loadtest/run.sh              # snapshot timing on an idle instance
SCENARIO=tracking ONLINE=1100 tools/loadtest/run.sh  # ESI polling alone
SCENARIO=soak DURATION_S=1800 PROFILE=1 HEAP_SNAPSHOT=1 tools/loadtest/run.sh
DB=postgres SCENARIO=cluster tools/loadtest/run.sh   # two replicas (CLUSTER=postgres) behind a proxy
```

| File                 | Runs in           | What it does                                                                    |
| -------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `run.sh`             | the host (docker) | network, Postgres, seed, fake ESI, app, load, resource sampling, clean-up       |
| `seed.mjs`           | the app image     | accounts, characters with tokens, sessions, maps with big chains, tracking      |
| `fake-esi.mjs`       | loadtest image    | location/ship/online with ESI's caching, token buckets, error limit; jumps      |
| `ws-load.mjs`        | loadtest image    | WebSocket clients: subscribe, cursors, marked edits; fan-out and jump latencies |
| `rest.k6.js`         | `grafana/k6`      | REST mix: reads, snapshots, moves, 200-line signature pastes, map pages         |
| `snapshot-bench.mjs` | loadtest image    | snapshot of the biggest map, one at a time                                      |
| `profile.mjs`        | the app (preload) | CPU profiles and heap snapshots on SIGWINCH, event-loop delay every 10 s        |
| `proxy.mjs`          | loadtest image    | round-robin HTTP and WebSocket proxy in front of two replicas                   |

Sizes come from the environment (`ACCOUNTS`, `MAPS`, `SYSTEMS`, `CONNECTIONS`, `TRACKED`, `ONLINE`,
`CLIENTS`, `CURSORS`, `CURSOR_HZ`, `EDITS_PER_S`, `RATE`, `BURST_SIZE`, `JUMP_EVERY_S`), CPU and memory caps
from `APP_CPUS` (2), `APP_MEM` (2g) and `LOAD_CPUS` (3). Results go to `OUT` (default `./loadtest-results`,
which is not committed): `ws.json`, `rest.json`, `snapshot.json`, `esi.json`, `resources.csv`, `app.log`,
`prof/`. Containers, the volume and the network are removed afterwards (`KEEP=1` keeps them).
