# Wormwright

A self-hosted wormhole and chain mapper for EVE Online. One container, one login (Discord), EVE characters
linked through EVE SSO, and every change streamed live to everyone looking at the map.

The engineering contract is [`docs/SPEC.md`](docs/SPEC.md); choices the spec leaves open are logged in
[`docs/decisions.md`](docs/decisions.md).

## Quick start

```sh
cp .env.example .env        # fill in PUBLIC_URL and the Discord/EVE applications
docker build -t wormwright .
docker run -p 3000:3000 -v ww-data:/data --env-file .env wormwright
```

Open `http://localhost:3000`. The first account to sign in becomes the instance owner. Data lives in the
`/data` volume (SQLite by default; set `DATABASE_URL=postgres://...` to use Postgres). Without `SECRET_KEY`
the server generates one and keeps it in `/data/secret.key`.

### Demo mode: a preview without Discord or EVE

```sh
docker build -t wormwright:dev .
docker run -d --name wormwright-preview -p 127.0.0.1::3000 -v wormwright-preview:/data \
  -e DEMO_MODE=true -e ALLOW_DEMO_MODE=true -e PUBLIC_URL=http://localhost wormwright:dev
docker port wormwright-preview 3000      # the random loopback port it landed on
```

Open that address and you are in: there is no sign-in form. With `DEMO_MODE=true` every visit without a
session is signed in as one shared **Demo pilot** account (the owner on a fresh instance) with two fake EVE
characters, and the first visit seeds a **Demo chain** map: a home C3 with both statics open, wormhole and
known-space neighbours, and connections that are end of life, reduced or critical, frigate-only, dangerous,
bubbled and a stargate, with labels and signatures. The map is seeded again only if the demo account has no
map left. Signing out shows the normal sign-in page with an "Explore the demo" button.

Anyone who can reach the instance gets in, so the server refuses `DEMO_MODE` with `NODE_ENV=production`
(the image's default) unless `ALLOW_DEMO_MODE=true` is set too. `DEV_LOGIN` and `ALLOW_DEV_LOGIN` still work as
deprecated aliases. Fake characters have no ESI token, so they can be tracked on a map but never move.
Scripts that need several people can sign in named local accounts with
`POST /api/auth/dev {"name": "...", "character": {"name": "..."}}` (demo mode only). Plugins and themes shipped
with the server are installed from Admin > Plugins and Admin > Themes. `docker rm -f wormwright-preview` stops
it; the `wormwright-preview` volume keeps the data.

### Appearance

The web app follows the computer's light or dark mode by default (and switches live when it changes); people
can pick System, Light, Dark, High contrast or an installed theme from the top bar, and the choice is kept on
their account. Fonts (Inter, JetBrains Mono) are bundled, so nothing is loaded from a CDN.

## Development

Node tooling never runs on the host. Everything runs in the dev container defined by
`docker-compose.dev.yml` (`dev` for commands, `postgres` for tests, `app` for the dev servers). With VS Code
you can also open the folder in the dev container (`.devcontainer/`).

```sh
dc() { docker compose -f docker-compose.dev.yml "$@"; }   # or pass -p <name> to isolate volumes

dc run --rm dev pnpm install
dc run --rm dev pnpm typecheck     # tsc -b over all packages + the web app
dc run --rm dev pnpm lint          # eslint (with import boundaries) + prettier --check
dc run --rm dev pnpm test          # vitest; DB tests run on SQLite and Postgres
dc run --rm dev pnpm test:pg       # Postgres only
dc run --rm dev pnpm build         # server/packages to dist, web app to apps/web/dist
dc run --rm dev pnpm format        # prettier --write
dc run --rm dev pnpm --filter @wormwright/sde universe   # rebuild universe.json from CCP's SDE (~100 MB download)

dc up app                          # API (watch mode) + Vite, DEMO_MODE=true
dc port app 5173                   # the random loopback port of the web app

# The web app alone, against an in-browser mock of the API and WebSocket:
dc run --rm -p 127.0.0.1::5173 dev pnpm --filter @wormwright/web dev:mock
```

No fixed host ports are published; `dc port` prints where the app landed.

## Layout

```
apps/server            NestJS composition root: Nest modules, controllers, ws gateway, adapters
apps/web               React SPA (Vite, React Flow, TanStack Query); design system in src/ui, shell in src/shell
packages/core          ids, Result, Clock, DomainEvent envelope, authorization, errors, core ports
packages/db            Kysely factory (SQLite/Postgres), Database = UnitOfWork, migrations/<module>/
packages/shared        zod DTOs, REST routes (routes.ts), WebSocket protocol, event catalogue
packages/modules/*     identity, access, mapping, tracking, notifications, plugins (domain/application/ports)
packages/plugin-sdk    plugin manifest, PluginContext, web slots
packages/theme-sdk     theme tokens, built-in themes, CSS generator
packages/sde           SDE builder and the committed universe dataset (systems, regions, gates)
plugins/*              first-party plugins (plugin-sdk only)
```

## Writing a module

1. **Ports and use cases** go in `packages/modules/<m>/src`. Domain code is framework-free; use cases are
   plain classes that take ports in the constructor, authorize the actor (`requireMapRole`,
   `requireAccount`), change state and append events in one transaction:

   ```ts
   await this.uow.transaction(async () => {
     await this.systems.insert(system);
     await this.events.append([
       newEvent({
         stream: mapStream(mapId),
         type: 'system.added',
         actor: actorRef(actor),
         data: system,
         occurredAt: this.clock.now(),
       }),
     ]);
   });
   ```

   Failures throw `DomainError` subclasses (`NotFoundError`, `ForbiddenError`, ...). Event payloads follow
   `EventPayloads` in `packages/shared/src/events.ts`.

2. **Migrations** go in `packages/db/migrations/<m>/0001_name.ts` (`up(db)`), using `col.*` types. No foreign
   keys into another module's tables.

3. **Adapters** (Kysely repositories, HTTP clients) go in `apps/server/src/adapters/<m>/`. Query through
   `database.db<Tables>()` so you join the caller's transaction. Test them with
   `describeEachDialect` from `@wormwright/db/testing`, which gives each test a fresh database on both
   SQLite and Postgres.

4. **The Nest module** goes in `apps/server/src/modules/<m>/` and is registered with one line in
   `apps/server/src/modules/index.ts`. Inject platform services with explicit tokens
   (`@Inject(EVENT_LOG)`, `@Inject(Database)`, `@Inject(APP_CONFIG)`, see `platform/tokens.ts`). Controllers
   use `nestPath(routes.x.y.path)`, `@CurrentActor()` and `ZodPipe` for bodies.

5. **Realtime**: inject `RealtimeRegistry` and, in `onModuleInit`, register stream authorizers
   (`registerStream('map', ...)`) and snapshot parts (`registerSnapshot('map', ...)`). Authentication is
   installed by identity through `ActorResolverRegistry.use(...)`.

Imports across those lines are checked by `pnpm lint` (`tools/eslint/boundaries.js`).
