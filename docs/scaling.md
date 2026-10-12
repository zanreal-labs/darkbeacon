# Scaling

How far one Darkbeacon instance goes, how that was measured, what limits it, and how to run more than
one process. Decisions behind this page are in [`decisions.md`](decisions.md); the harness is in
[`tools/loadtest/`](../tools/loadtest/README.md).

## Supported envelope

One container, 2 vCPU and 2 GB of memory, on SQLite or Postgres 17, holds a whole alliance:

| Dimension                        | Supported                                      | Measured at (`full` scenario)                         |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Accounts / linked characters     | 3,000 / 6,000                                  | 3,000 / 6,000                                         |
| Maps                             | 50, each 500+ systems and 1,000 connections    | 50 × 500 systems, 1,000 connections, 1,000 signatures |
| Tracked characters online        | 600 at a 5 s cadence (1,100 within the budget) | 600 online, 1,658 tracked                             |
| Jumps reaching the map           | bursts of 50 a second                          | 250 jumping at once every 30 s, plus 5 a second       |
| WebSocket clients                | 400                                            | 400 (233 on the main map)                             |
| People moving cursors on one map | 150                                            | 150 at 15 Hz                                          |
| REST traffic                     | 50 requests a second                           | reads, snapshots, moves, pastes, map pages            |
| Signature paste                  | 200 lines                                      | one every 2 s                                         |

Targets and results with that load running at once, on the code of this branch merged with `main` at
`f846cf9` (intel, Wanderer import, routes and bridges, access and admin; p95 unless noted):

| Target                                      | Goal     | SQLite                          | Postgres       |
| ------------------------------------------- | -------- | ------------------------------- | -------------- |
| REST API                                    | < 150 ms | 43 ms (p99 122)                 | 30 ms (p99 72) |
| Map snapshot, 500 systems (under load)      | < 300 ms | 297 ms                          | 78 ms          |
| Realtime fan-out (edit to every client)     | < 250 ms | 44 ms                           | 56 ms          |
| Presence fan-out (cursor to every peer)     | < 250 ms | 88 ms                           | 73 ms          |
| Server memory (API and web server together) | < 1 GB   | 997 MB peak; 1.06 GB at 30 min¹ | 922 MB peak    |

The same check on the code merged with `a12a927` (the before-and-after table below) gave REST 30 ms and
19 ms, snapshots 295 ms and 83 ms, edit fan-out 41 ms and 29 ms, presence 85 ms and 71 ms, peak RSS 939 and
888 MB: what `main` added since (bookmark numbers and the way home among the snapshot's and the router's
work, offline characters filtered per viewer) costs a little CPU (SQLite p50 43 to 51 % of two cores)
and leaves every target where it was. Intel's outside sources are off in load runs (they would read
zKillboard and EVE's ESI); serving intel to viewers is not part of the load.

¹ The 30-minute soak ran on the code merged with `a12a927`.

Memory is at the limit rather than under it: the API process levels off at about 650 MB and the Next.js
server at about 400 MB (see [Memory over time](#memory-over-time)). Give the container 1.5 GB.

Beyond this the instance degrades gracefully rather than falling over: past the ESI budget every
character is polled a little less often (maps someone has open first), crowded maps get fewer presence
flushes a second, and a single map has no hard size limit (snapshots grow linearly, about 2 KB per system
with its connections and signatures).

## How it was measured

- Hardware: Apple M4 Max, Docker on OrbStack (Linux 7.0, 8 CPUs, 64 GB). The app container was capped at
  2 CPUs and 2 GB (`--cpus 2 --memory 2g`), Postgres 17 at 2 CPUs and 2 GB, the load generators ran in
  their own containers (3 CPUs for the WebSocket clients, 2 for k6, 1 for the fake ESI). Numbers on a
  2 vCPU VPS are of the same order; Apple cores are fast, so leave headroom.
- Image: the production `Dockerfile` (`darkbeacon:perf`), `NODE_ENV=production`, Next.js standalone behind
  the API as in production, telemetry off. "Before" is the same harness against `main` at `a12a927` with
  only `ESI_BASE_URL` added (so it can be pointed at the fake ESI); "after" is this branch merged with it.
- Data (`seed.mjs`): 3,000 accounts with 2 characters each in one alliance, a session each, 50 maps of 500
  systems (80 % wormhole space), 1,000 connections and 1,000 signatures, an alliance rule and 20 personal
  rules per map, 1,500 accounts tracking a character (10 % on two maps, 40 % on the main map), 600 online.
- Load, 180 s at once (`full` scenario):
  - fake ESI (`fake-esi.mjs`): ESI's caching (5/5/60 s, ETag, 304), `char-location` token buckets
    (1200/15 min, 2/1/5/0 tokens), the 100-errors-a-minute limit with 420s, 30-120 ms answers, 0.05 % 503s;
    online characters jump every 2 minutes on average along their map's chain (5 % into new systems), plus
    250 of them at once every 30 s;
  - 400 WebSocket clients (`ws-load.mjs`), each opening a map like the web app does (the snapshot over HTTP,
    then the socket resuming from its seq); 150 on the main map move their cursor at 15 Hz; an editor moves
    a system on the main map twice a second, each move marked so its arrival at every client is timed;
  - k6 (`rest.k6.js`, `grafana/k6:1.3.0`) at 50 requests a second: account, maps, landing, characters,
    preferences, map, signatures and history reads (40/s), snapshots (2/s, mostly the main map), system
    moves (5/s), 200-line signature pastes of a system's own signatures with 5 % new ones (0.5/s) and
    server-rendered map pages (2/s).
- Measured: k6 per-request latencies, the clients' fan-out times (sender and receivers share a clock), how
  long a fake jump takes to reach a client as `character.jumped`, how often ESI is asked for each
  character's location, CPU and RSS of the app container every 5 s, event-loop delay every 10 s, CPU
  profiles of both node processes (`profile.mjs`).

### Before and after

| Metric (p95 unless noted)                           | SQLite before | SQLite after | Postgres before | Postgres after |
| --------------------------------------------------- | ------------- | ------------ | --------------- | -------------- |
| REST API (reads and moves)                          | 527 ms        | 30 ms        | 116 ms          | 19 ms          |
| REST API p99                                        | 947 ms        | 84 ms        | 206 ms          | 44 ms          |
| Map snapshot, 500 systems, under load               | 749 ms        | 295 ms       | 161 ms          | 83 ms          |
| Map snapshot, alone (p50)                           | 61 ms         | 8 ms         | 49 ms           | 17 ms          |
| Map page, server-rendered                           | 3,233 ms      | 475 ms       | 332 ms          | 134 ms         |
| Signature paste, 200 lines                          | 852 ms        | 58 ms        | 352 ms          | 82 ms          |
| Edit fan-out (move sent to arrival at every client) | 516 ms        | 41 ms        | 62 ms           | 29 ms          |
| Presence fan-out (cursor to every peer)             | 177 ms        | 85 ms        | 92 ms           | 71 ms          |
| Snapshot when 400 clients open the map              | 9,829 ms      | 48 ms        | 877 ms          | 62 ms          |
| Jump reaching the map, p50                          | 6.4 s         | 2.7 s        | 5.9 s           | 2.7 s          |
| Jump reaching the map                               | 16.9 s        | 5.1 s        | 14.2 s          | 5.2 s          |
| Location asked for, interval                        | 39.1 s        | 5.6 s        | 17.1 s          | 5.6 s          |
| ESI requests a second                               | 91            | 248          | 111             | 248            |
| Received per client                                 | 131 KB/s      | 26 KB/s      | 211 KB/s        | 29 KB/s        |
| Server CPU p50 / p95 (200 % = both cores)           | 102 / 122 %   | 43 / 111 %   | 91 / 116 %      | 52 / 102 %     |
| Event-loop delay p99 (worst 10 s windows)           | 9,588 ms      | 252 ms       | 114 ms          | 18 ms          |
| Peak RSS, API and web server together               | 2,135 MB      | 939 MB       | 984 MB          | 888 MB         |

The "after" columns do two to four times the tracking work of the "before" ones (each location asked for
every 5.6 s at p95 instead of every 17-39 s) on half the CPU. A map with 150 people moving flushes
presence 4 times a second instead of 15 (the per-viewer budget), which is what cut each client's traffic;
cursors stay under 100 ms old at p95 because every flush carries the newest position. Of the jumps the
fake ESI made on the main map, 93 % reached it as `character.jumped`; 4 % were passed by a second jump
within the same poll (the map shows where the character ended up) and 3 % fell into the first and last
seconds of the run (a character's first observation is a move, not a jump). SQLite's snapshot p95 under
load sits close to the target; its median is 11 ms, the tail is reads queued behind synchronous work
(event-log pages read by the consumers, route searches after chain changes).

What the "before" columns show: tracking could not keep up (the poller started at most 8 characters at a
time and waited for the slowest, so a jump took 14-17 s at p95, up to a minute, to reach the map); every
client received 130-210 KB/s (the full list of 150 peers, re-serialized per viewer, 15 times a second);
and on `main` every map snapshot searched the universe once per known-space exit (the route space of
each exit), so on SQLite 400 people opening a 500-system map stalled the server for seconds at a time.

The same comparison against the commit this work started from (`f8748d8`, before main brought the exits'
route space, the passages and sharing) gave REST p95 82 to 16 ms on SQLite and 101 to 20 ms on Postgres,
edit fan-out 80 to 21 ms and 88 to 47 ms, presence 82 to 72 ms and 87 to 70 ms, jumps reaching the map
13.6 to 5.1 s and 16.1 to 5.3 s at p95, with peak RSS around 800 MB either way.

## Bottlenecks found, and what changed

Each was found in a profile or a measurement first; the commits say more.

| Found                                                                                     | Fix                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Presence: full peer list per viewer per flush, 90 MB/s egress, ~40 % of the API busy time | patches (key and changed fields), serialized once per flush, per-viewer budget of 600 peer updates/s    |
| Events serialized once per subscribed socket                                              | once per stream                                                                                         |
| One system call per frame per socket (a paste is 200 frames to every viewer)              | frames of one turn of the event loop corked into one write                                              |
| Poller: 8 at a time, ticks skipped while busy; then 64 per tick, ticks once a second      | 64 workers pulling due characters, 250 ms ticks, budget 500 req/s, viewed maps first, spread and jitter |
| Poller: database reads on every poll                                                      | none for 304s; ownership and roles once a minute; tokens reused 30 s; tracked list cached               |
| ESI: no global error accounting on rate-limited routes (they carry no error headers)      | own count, stop at 50 a minute; outage pause after 5 server errors in 10 s                              |
| SQLite: every read waited for the transaction holding the one connection                  | a write connection and read-only ones (WAL); snapshots on their own read connection                     |
| SQLite: WAL checkpoints inside commits, on the event loop: up to 800 ms stalls            | PASSIVE checkpoints every second on a worker thread                                                     |
| SQLite: every query prepared again                                                        | prepared statements cached per SQL                                                                      |
| Access: four queries per authorization, on every request and socket re-check              | `AccessCache`, 10 s, dropped on the events that change access                                           |
| Event consumers: every event woke every consumer to scan every stream; a transaction each | only the consumers and the stream an event concerns; 25 events per transaction                          |
| Auto-mapping read the whole map (twice) and all tracked characters per jump               | single-row lookups; the connection between two systems from the pair index                              |
| Route searches over the universe back to back (100 ms at a time)                          | each yields to the event loop first                                                                     |
| Exits (`main`): a universe search per known-space exit, on every map snapshot             | kept per state of the chain and its hubs; searches yield to the event loop                              |
| permessage-deflate (tried for snapshots): browsers then compress every frame they send    | left off; snapshots come with the page over HTTP and sockets resume with a replay                       |

Checked and fine as they are: every hot query uses an index (`node apps/server/loadtest/explain.mjs` in the
app image prints the plans; two did not and got one), the outbox consumers already woke on the bus (the
5 s poll is only the catch-up), the snapshot is what the map needs (systems, connections, signatures,
tracked characters, exits; about 1 MB of JSON for 500 systems, gzip over HTTP), and Next.js renders a map
page in about 40 ms of CPU.

## ESI: the real ceiling of tracking

Rules, as published on 2026-10-12:

- Location, ship and online are in the `char-location` rate-limit group: **1,200 tokens per 15 minutes per
  application and character**; a 2xx costs 2 tokens, a 304 1, a 4xx 5, a 5xx 0; over the limit ESI answers
  429 with `Retry-After`. Headers `X-Ratelimit-Group`, `-Limit` (`1200/15m`), `-Remaining`, `-Used`.
  [Rate limiting](https://developers.eveonline.com/docs/services/esi/rate-limiting/),
  [Hold your horses](https://developers.eveonline.com/blog/hold-your-horses-introducing-rate-limiting-to-esi),
  `x-rate-limit` in [the OpenAPI spec](https://esi.evetech.net/meta/openapi.json).
- The error limit still applies: **100 non-2xx/3xx answers a minute**, then 420 for every route. Routes in
  a rate-limit group do not send `X-ESI-Error-Limit-*` headers.
  [Rate limiting](https://developers.eveonline.com/docs/services/esi/rate-limiting/),
  [Best practices](https://developers.eveonline.com/docs/services/esi/best-practices/).
- Cache: location 5 s, ship 5 s, online 60 s (`x-client-cache-ttl` in the spec); asking
  before expiry is cache circumvention. Prefer `Cache-Control` over `Expires`
  ([Smarter caching](https://developers.eveonline.com/blog/smarter-caching-when-events-drive-invalidation)).
  A 304 still costs a token.
- No per-application request rate is published; the per-character bucket is the binding limit.

What the poller does: online first (location and ship only while online), then location and ship every
5 s or later if the cache says so, with `If-None-Match`; up to 64 characters in flight; a global budget of
**500 requests a second**; characters on maps someone has open first when the budget is short; first
polls spread over 15 s after a start and up to 500 ms of jitter on every next one; per-character backoff
on 5xx (5 s doubling to 5 minutes), 5 minutes after 401/403, `Retry-After` on 429 and 420, a bucket left
alone for a tenth of its window below 10 % remaining, a global stop at 50 own errors a minute and a global
pause when 5 calls fail on server errors within 10 s.

The arithmetic:

- One online character: location and ship every 5 s plus online every 60 s = **0.42 requests a second**,
  375 requests per 15 minutes; at most 750 tokens (all 2xx), typically about 400 (mostly 304s). That is
  well inside 1,200, so no character is ever rate limited at this cadence.
- One tracked character offline: online every 60 s = 0.017 requests a second.
- With the budget of 500 requests a second: `online ≤ (500 − 0.017 × offline) / 0.42`, about **1,150
  online characters** next to 1,000 offline ones, every one at the full 5 s cadence. Measured
  (`SCENARIO=tracking`): 1,100 online next to 1,000 offline sent 408 requests a second and asked for each
  location every 5.5 s (p95 7.1 s), at 25 % of one core. Past that, each character is polled a little less
  often: 1,500 online next to 1,400 offline used the budget (472 a second), location every 6.1 s (p95
  11 s), at 44 % of one core. Maps someone has open keep their cadence first.
- Cost on the server: about 6-9 % of one core per 100 ESI requests a second, including the events
  of the jumps (fake ESI over plain HTTP; TLS to the real ESI adds a little).
- Errors: at 500 requests a second the error limit allows 0.33 % errors a minute and the poller stops at
  0.17 %; an ESI outage trips the global pause long before 100 errors.

`ESI_REQUESTS_PER_SECOND` in `apps/server/src/modules/tracking/tracking.module.ts` is the knob; raise it
only together with CPU, and not past what the per-character buckets allow.

## SQLite or Postgres

SQLite (the default, `/data/app.db`) carries the whole envelope above on one container, with lower
latencies than Postgres for reads (no network hop) and nothing to operate. Postgres is the choice when:

- you want more than one process (`CLUSTER=postgres`, below) or rolling restarts without downtime;
- you want backups, replicas or point-in-time recovery from your database tooling;
- the event log gets very large (years of history kept, many instances' worth of maps) and you want
  `VACUUM`, partitioning or a bigger machine for the database alone;
- writes go well past the measured load: SQLite has one writer, and at the measured load it is busy a
  small fraction of the time; sustained thousands of writes a second (much bigger alliances, many
  plugins consuming every event) are Postgres territory.

The built-in backup of SQLite holds every connection while it copies the file. Under the measured load
it took 4 s (one each day by default); on a machine whose CPUs were busy with other work it took 97 s,
and every request waited that long. Scheduled backups run one interval after the last one, so a manual
backup at a quiet hour moves the daily one there ([`backups.md`](backups.md)); or use Postgres and its tooling.

Switching later is a data migration (export and import); the schema and code are the same.

## More than one process

Status: implemented behind `CLUSTER=postgres`, tested with two replicas behind a round-robin proxy
(`SCENARIO=cluster`), not the default. Everything that assumed a single process now goes through a port:

| Assumption                     | Port (core or edge) | Single process    | `CLUSTER=postgres`                                          |
| ------------------------------ | ------------------- | ----------------- | ----------------------------------------------------------- |
| Events reach every subscriber  | `EventBus`          | in process        | local dispatch + NOTIFY of stream ranges, read from the log |
| Once-per-instance work         | `Leadership`        | always the leader | session advisory lock, another replica takes over in ≤ 2 s  |
| Who is on a map, cursors       | `PresenceRelay`     | none              | NOTIFY of each replica's own peers, repeated every 5 s      |
| Small news for every replica   | `Signals`           | in process        | NOTIFY, delivered at once to the sender                     |
| Rate limits (ESI budget, edge) | `RateLimiter`       | token buckets     | token buckets per replica (see below)                       |

On the leader only:

- the ESI poller and durable event consumers (auto-mapping, passages, webhooks with their retries and
  turning failing ones off, plugins' consumers, clean-ups);
- intel's jobs: ESI sovereignty and hourly figures, zKillboard history and the R2Z2 feed, pruning. Every
  replica pushes what they changed to its own viewers (`intel.changed` signals) and reads whether the
  feed is live from what the leader writes;
- merging shared maps: the leader merges each change once; the others forget what they kept of a map when
  its stream moves and build it again from what is stored when a request needs it. A replica that starts
  leading merges every shared map again;
- Wanderer imports and syncs: a job queued on another replica is signalled to the leader, and a new leader
  resumes jobs the old one left running;
- schedules: event retention, the chain sweeper, the signature sweep, routing exits and the way home
  (computed and published), the affiliation refresh (corporations and alliances of every character,
  every 10 minutes), session, OAuth, delivery and tombstone prunes, the telemetry heartbeat, installing
  bundled plugins and plugins' background work (`ctx.every`).

Everywhere: HTTP, WebSockets and SSE with their fan-out, access caches (kept current by the bus), the
router's tables, and three small public reads each replica keeps in memory: EVE-Scout's Thera and
Turnur holes (one request every 5 minutes) and ESI's sovereignty holders for bridges (one an hour), which
its routes use, and Tranquility's status (`/status`, once a minute), which it shows its clients; the
leader's copy also pauses tracking during downtime.
Committed events are counted for OpenTelemetry by the replica that committed them. Built-in backups are
SQLite's; a cluster runs on Postgres and is backed up with its tooling.

Requirements and limits:

- Replicas share `DATABASE_URL` and `DATA_DIR` (plugin packages and `secret.key` live there) and the same
  `SECRET_KEY`. Plugin installs and switches made on one replica reach the others through `plugin.*` events.
- The load balancer needs no stickiness; WebSockets resume from their seq on any replica.
- Rate limits are counted per replica: one client spread over N replicas by the load balancer gets N
  times `RATE_LIMIT_PER_ADDRESS` (and its API keys' limits). Sticky sessions by client address keep it
  exact. The ESI budget is the leader's, the only one polling.
- Per-process state that stays per process: ESI name-lookup caches and their error-limit reading
  (`EsiDirectoryHttp`, each replica has its own IP anyway), the Discord bot's short caches, the plugin
  failure counters.
- Plugins: `ctx.on` handlers run on every replica (each has its own bus), `ctx.consume` and `ctx.every` on
  the leader only; a plugin with side effects (posting somewhere) belongs in `consume`, or checks
  `ctx.isLeader()`.
- The poller's "maps someone has open first" counts the leader's sockets only.
- A drag or a note on a shared map handled by a follower merges from what is stored; if the leader is
  merging the same map at that moment, the later write wins, as with any two edits.
- NOTIFY payloads are limited to 8 kB, so the bus sends stream ranges, not events, presence is split by
  peers and intel changes by systems; a lost notification costs a gap the hub fills from the log (events),
  a cursor that is late until the next change (presence) or intel figures that are late until the next
  change (signals).

Measured with two replicas (`SCENARIO=cluster`, merged code: Postgres, the same load through a round-robin
proxy, each WebSocket on whichever replica it reached, 2 CPUs per replica, one Postgres with 2 CPUs):
REST API p95 31 ms (p99 76), snapshot under load p95 233 ms, edit fan-out p95 54 ms (half the clients are
on the other replica than the editor's request), presence fan-out p95 113 ms (cursors cross replicas
through the relay), jumps reaching the map p95 5.2 s, ESI 248 requests a second from the leader alone.
CPU p50 44 % on the leader (poller, consumers) and 23 % on the follower; peak RSS 907 and 715 MB. Two
replicas on one 2-CPU Postgres are not faster than one process on it at this load (the database is the
shared part); replicas buy availability and rolling restarts, and room for more WebSocket clients. Stopping the leader (`docker stop`) in a running
two-replica instance: the other replica logged "this replica leads" within its 2 s retry and ESI polling
went on from there; `apps/server/src/adapters/cluster/cluster.test.ts` covers the same hand-over.

## Memory over time

Thirty minutes of the full load on SQLite (`SCENARIO=soak`, merged code): latencies held (REST p95 24 ms,
edit fan-out p95 31 ms, presence p95 76 ms, jumps reaching the map p95 5.2 s, 9,573 of them), and memory
levelled off: the API process grew to about 645 MB in the first five minutes and stayed there (JavaScript
heap 160-230 MB used throughout), the Next.js server to about 400 MB within ten minutes. Together
1.03-1.06 GB from minute 12 to 30. The first ten seconds after a start held one stall of 2.6 s (startup
work while 400 clients opened the map at once); after that the event loop's worst 10 s windows stayed
under 120 ms.

Earlier soaks found two growths that are fixed: SQLite's statement cache kept hundreds of big batch-insert
statements (one per row count; long SQL is no longer cached), and presence rooms without a relay never
forgot anyone who left. The harness's original pastes added 200 new signatures every 2 s, which measures
data growth (30 minutes is 180,000 signatures) rather than steady state; pastes now rescan a system's own
signatures.

## Running the harness

Everything runs in containers; nothing touches the real ESI (the network has no way out).

```sh
docker build -t darkbeacon:perf .
tools/loadtest/run.sh                                         # SQLite, full scenario, 120 s
DB=postgres DURATION_S=180 PROFILE=1 tools/loadtest/run.sh    # Postgres 17, with CPU profiles
SCENARIO=tracking ONLINE=1100 TRACKED=2100 tools/loadtest/run.sh
SCENARIO=soak DURATION_S=1800 PROFILE=1 HEAP_SNAPSHOT=1 APP_MEM=3g tools/loadtest/run.sh
DB=postgres SCENARIO=cluster tools/loadtest/run.sh            # two replicas behind a proxy
```

Results land in `OUT` (default `./loadtest-results/<time>-<db>-<scenario>/`, not committed): `ws.json`
(fan-out, presence, jump and snapshot latencies, ESI statistics), `rest.json` (k6 summary per endpoint),
`snapshot.json`, `resources.csv`, `app.log` (with event-loop delay), and with `PROFILE=1` `prof/*.cpuprofile`
for Chrome DevTools or speedscope. Sizes and rates are environment variables listed in
[`tools/loadtest/README.md`](../tools/loadtest/README.md).
