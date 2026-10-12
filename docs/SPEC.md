# Darkbeacon — engineering spec (v0)

A self-hosted wormhole and chain mapper for EVE Online, written from scratch. Not a fork of Wanderer and no
code is taken from it. This file is the contract every module builds against: when something here and your own
taste disagree, follow this file; when something is missing, choose the simplest option and write it down in
`docs/decisions.md`.

## Priorities

1. **UX and low complexity.** One container, one login, no separate admin passwords, sensible defaults.
2. **Real time.** Every change is an event; clients, webhooks, the API stream and plugins all feed from it.
3. **Modular and future proof.** Hexagonal architecture, native plugins built on the core's ports, token-based themes.

## Runtime and tooling

- Node 24 LTS, TypeScript (strict, ESM everywhere), pnpm 10 workspaces with `node-linker=hoisted`.
- Server: NestJS 12 on the Fastify adapter, WebSockets through `@nestjs/platform-ws` (plain `ws`, no socket.io).
  It is the one front door: REST under `/api`, WebSocket at `/ws`, everything else proxied (streaming) to the
  web app's Next.js server, which it starts on a loopback port in the same container.
- Web: Next.js 16 (App Router, Cache Components / Partial Prerendering, `output: 'standalone'`), React 19,
  `@xyflow/react` (React Flow 12). The app shell is prerendered; per-user data streams in through Suspense,
  read on the server from the API with the visitor's cookie. Styling via CSS variables (theme tokens) and CSS
  modules. Mutations go over REST from the browser (TanStack Query, optimistic); realtime through one
  WebSocket client.
- Database: Kysely. SQLite (`better-sqlite3`) by default at `/data/app.db`; Postgres (`pg`) when `DATABASE_URL`
  starts with `postgres`. ONE set of TypeScript migrations that runs on both. Portable column types only:
  text, integer, real; JSON stored as text (helper may use jsonb on Postgres); timestamps as integer epoch ms;
  booleans as 0/1. Migrations run at startup.
- Tests: Vitest. Every repository/integration test runs against SQLite AND Postgres (`TEST_DATABASE_URL`).
- Never install or run Node tooling on the host. Use the dev container:
  `docker compose -f docker-compose.dev.yml run --rm dev <cmd>` (e.g. `pnpm install`, `pnpm test`).
  The dev compose file defines `dev` (node:24, corepack pnpm, repo bind-mounted at /workspace, root
  `node_modules` and the pnpm store in named volumes) and `postgres` (postgres:17) for tests.
- Commits: plain `git commit` with the repo's own voice. No AI/assistant mentions or co-author trailers anywhere.

## Repository layout

```
apps/server            NestJS composition root: Nest modules, controllers, gateways, adapters, plugin loader, MCP
apps/web               Next.js app: map, widgets, settings, admin tab
packages/core          shared kernel: ids, Result, clock, event envelope, authorization primitives, errors
packages/modules/identity       accounts, sessions, Discord login, EVE character linking
packages/modules/access         instance roles, map roles, access rules (Discord role / character / corp / alliance)
packages/modules/mapping        maps, systems, connections, signatures, labels
packages/modules/tracking       ESI polling -> character events, auto-mapping subscribers
packages/modules/notifications  notifier port + webhook delivery
packages/modules/plugins        plugin registry, manifest validation, enable/disable state
packages/modules/routing        routes over stargates and the chain, hubs, chain exits, in-game waypoints
packages/modules/audit          audit records of events, histories, reverts, hash chain check
packages/modules/sharing        shares between maps, composite maps, merging several maps' chains
packages/modules/publishing     public links of maps (/p/<token>), what they show, a map's reach for AI agents
packages/modules/api-keys       personal access tokens and service keys: scopes, expiry, address allow-lists
packages/modules/oauth          OAuth 2.1 authorization server for the MCP endpoint
packages/modules/telemetry      anonymous product telemetry: allow-list, pseudonymous ids, opt-outs, heartbeat
packages/modules/observability  telemetry settings, domain metrics, admin status (OpenTelemetry SDK in adapters)
packages/modules/backups        SQLite backups: snapshots, schedule, retention, validation, restore
packages/modules/importing      imports of whole maps from Wanderer (API and export file), merge, sync
packages/db            Kysely factory, dialect switch, migration runner; migrations in migrations/<module>/
packages/shared        zod schemas, DTOs and the WebSocket protocol shared by server and web
packages/plugin-sdk    public plugin contract: manifest type, PluginContext (exposed ports), web slots
packages/theme-sdk     token catalogue, built-in themes (default, dark, contrast), CSS generator
packages/sde           script that builds static game data (systems, regions, classes, security) from CCP's SDE
plugins/*              first-party plugins, built against plugin-sdk only
```

## Hexagonal rules

- `packages/modules/*/src/domain` — entities and rules, framework-free, no I/O.
- `packages/modules/*/src/application` — use cases (commands/queries). Each use case authorizes the actor,
  changes state through ports, and appends events. Use cases are plain classes taking ports in the constructor.
- `packages/modules/*/src/ports` — interfaces (e.g. `MapRepository`, `EventLog`, `EventBus`, `EsiGateway`,
  `IdentityProvider`, `Notifier`, `Clock`).
- Adapters (Kysely repositories, ESI/Discord HTTP clients, ws gateway, webhook sender) live in
  `apps/server/src/adapters/<module>/`. NestJS is ONLY the composition root and the HTTP/WS edge.
- A module never imports another module's internals; it may import another module's `index.ts` public API or
  react to its events. Enforce with an ESLint boundaries rule in CI.

## Events (the real-time backbone)

Envelope (in `packages/core`):

```ts
interface DomainEvent<T = unknown> {
  id: string;            // uuid v7
  seq: number;           // monotonically increasing per stream (per map; instance stream for non-map events)
  stream: string;        // 'map:<mapId>' | 'instance'
  type: string;          // e.g. 'system.added'
  occurredAt: number;    // epoch ms
  actor: { kind: 'account' | 'apiToken' | 'system' | 'plugin'; id: string };
  data: T;
  v: 1;                  // envelope/schema version
}
```

- State change and event append happen in ONE transaction (`event_log` table = outbox). After commit the event
  goes on the in-process `EventBus` (interface allows a Postgres LISTEN/NOTIFY implementation later).
- WebSocket protocol (in `packages/shared`): client sends `{op:'subscribe', stream, sinceSeq?}`; server replays
  missing events from `event_log` or answers `{op:'snapshot', ...}` when the gap is too large, then pushes
  `{op:'event', event}`. Commands from the client go over REST; the result arrives as events (optimistic UI on
  the client, rollback on rejection).
- Event catalogue v1: `system.added|updated|removed`, `connection.added|updated|removed|passage`,
  `signature.added|updated|removed`, `character.moved|jumped|ship_changed|online_changed`,
  `map.settings_changed`, `labels.changed`, `ping.created|removed`, `access.rule_added|rule_removed|role_changed`,
  `map.share.offered|accepted|changed|revoked`, `map.sources_changed`.
- Webhooks: per map, chosen event types, HMAC-SHA256 signature header, retries with backoff, delivery log.
- Retention of `event_log` configurable (default: keep everything; the log is the audit trail).
- Audit trail: every event is stored with who (account, character in use, names), how (web, API token,
  plugin, system process), from where (country, user agent) and what changed (field-level diff, or the
  removed snapshot); histories per map, system, connection and person, an instance audit, CSV/JSON
  export, reverting a single change, a hash chain per stream. See `docs/decisions.md`.
- Presence over `/ws` (cursors, drag previews, editing markers, selections, who is here): ephemeral,
  never stored, coalesced per map, authorized like the map stream.

## Identity and access

- Login with Discord OAuth2 (`identify guilds guilds.members.read`). Account = Discord user.
- Link EVE characters with EVE SSO v2 (authorization code + PKCE S256); validate the JWT against the JWKS
  advertised in `https://login.eveonline.com/.well-known/oauth-authorization-server`; check iss/aud/exp.
  One character belongs to one account; linking a character owned elsewhere is refused with a clear message.
  EVE tokens encrypted at rest (AES-256-GCM with a key derived from `SECRET_KEY`).
- Server-side sessions (table), httpOnly cookie, "log out everywhere".
- Instance roles: `owner` (first account to log in; can only be transferred), `admin`, `user`. Admin may come
  from a Discord role on a configured guild. The admin panel is a tab in the same app; no other login.
- Map roles: `viewer`, `member`, `manager`, `admin`, `blocked`. Access rules on a map grant a role by Discord
  guild role, EVE character, corporation or alliance. Highest matching role wins; `blocked` on character or
  account beats everything. Map owner = an account (not a character).
- Every use case checks authorization on the server; the UI hides what the user cannot do.
- `DEMO_MODE=true` (refused when `NODE_ENV=production` unless `ALLOW_DEMO_MODE=true`; `DEV_LOGIN` is a
  deprecated alias) signs every unauthenticated visit in as a shared demo account with fake characters and
  seeds a demo map, for local previews without Discord/EVE. There is no sign-in form.

## Mapping (MVP slice)

- Map: id, slug, name, owner account, settings (scopes: wormhole/high/low/null/pochven), labels list
  (id, name, color, description — editable by manager+).
- System on map: solar system id, position, custom name, temporary name, tag, status, description (markdown),
  labels, locked, visible (hidden systems keep their intel; nothing routes to hidden systems).
- Connection: source, target, type (wormhole|gate|bridge), time status, mass status, ship size, mass-saved flag,
  dangerous, bubbled (none|source|target|both).
- Signature: system, eve id, group, type, name, description, linked connection, timestamps; paste parser
  for the in-game probe scanner (EN first; parser built to add RU/DE/FR).
- Tracking: poll ESI location/ship every 5 s and online every 60 s only for characters tracked on a map, honour
  `Expires`/`ETag` and the `X-Ratelimit-*` headers; emit `character.*` events; auto-mapping (add system,
  add connection on jump) is a subscriber of those events, respecting map scopes.

## Sharing and composite maps

- A map's admin shares it with another map (`read` or `read-write`, with scopes from `shareScope`:
  topology, connection status, signatures, intel, characters, bookmark labels); the target's admin
  accepts (consent), either side revokes; audited as `map.share.*` on both maps' streams.
- A composite map has no objects of its own and merges the maps shared with it (an alliance chain);
  a standard map may merge shared maps too. Viewers of a merged map gain no access to its sources.
- Merge: systems by solar system id, connections by unordered pair (+ wormhole type when known),
  signatures by system and code; every field last-writer-wins by its own change time; deletions
  are tombstones. Positions are the merged map's own layout. Provenance (source maps, newest change)
  shows in one line in the sidebar, never on the canvas.
- Merged changes are published on the merged map's own stream with its own seq; edits on a merged
  map write through to read-write sources only, never past the share's scopes.
  A composite keeps its own notes, labels and locks of systems; raising a share to read-write
  needs the target's consent again; webhooks and plugins of a map with objects of its own skip
  the merged copies.
- Sources sit behind the `ChainSource` port in a wire-ready delta format (stable keys, stamped
  fields, tombstones, scopes cut at the source), so a map on another instance can be a source later.

## Plugins (native)

- A plugin is an npm package (or .tgz) with `darkbeacon-plugin.json` manifest:
  `{ id, name, version, sdk: "^1.0", server?: "dist/server.js", web?: "dist/web.js", ports: [...], events: [...],
  settings?: "settings.schema.json", migrations?: "migrations/" }`.
- Installed by an admin from the panel (catalogue entry, npm name, or uploaded .tgz) into `/data/plugins`.
  Loaded natively into the server process: `register(ctx: PluginContext)` receives ONLY the ports listed in the
  manifest (dependency injection) plus `on(eventType, handler)`, `commands`, `settings`, `logger`,
  `http.route()` under `/api/plugins/<id>`. A plugin may provide an adapter for a port (e.g. a `Notifier`).
- Plugin errors are caught by the core; a plugin that keeps failing is disabled with a message in the panel.
- Enable/disable per instance and per map without restart; installing a new version reloads the process.
- Web part: an ES module loaded at runtime that registers components into named slots
  (`widget`, `systemContextMenu`, `connectionContextMenu`, `nodeBadge`, `edgeBadge`, `settingsPage`).
- First-party plugins live in `plugins/` and use only `plugin-sdk`.

## Themes

- A theme is a package with a manifest and a token map (CSS custom properties); no code.
- Token catalogue and built-in themes live in `theme-sdk`. One node component and one edge component; themes
  only change tokens, so no feature disappears in another theme.
- User picks a theme; admin sets the instance/map default. Theme editor with live preview is a later step.

## Configuration

Environment only for what must exist before the first login: `PUBLIC_URL`, `SECRET_KEY`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `EVE_CLIENT_ID`, `EVE_CLIENT_SECRET`, `DATABASE_URL` (optional),
`PORT` (default 3000), `DATA_DIR` (default /data), `DEMO_MODE`. Everything else is stored in the database and
edited in the admin tab, except observability: the standard `OTEL_*` variables plus `METRICS_PROMETHEUS` and
`METRICS_TOKEN` (docs/observability.md), shown read-only in the admin tab.

## Container

Multi-stage `Dockerfile`; final image runs `node apps/server/dist/main.js`, which starts the web app's
standalone server (`apps/web/.next/standalone`) behind it, exposes `PORT`, declares volume `/data`. `docker run -p 3000:3000 -v dbk-data:/data --env-file .env <image>` must work.
