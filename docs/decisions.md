# Decisions

Choices made where `docs/SPEC.md` is silent. One line each; newest at the bottom.

- Toolchain pins: Node 24, pnpm 10.34 (`packageManager`), TypeScript 6.0 (typescript-eslint does not support TS 7 yet), NestJS 12, Fastify 5, Kysely 0.29, Vite 8, React 19, React Router 8, TanStack Query 5, Vitest 5, zod 4.
- Workspace packages export TypeScript source under a `source` condition; `tsc -b` (project references) builds `dist/` for production, Vite resolves `source`, Vitest aliases every workspace export to its source (see `vitest.config.ts`).
- Server and packages use NodeNext ESM, so relative imports end in `.js`; the web app uses bundler resolution and extensionless imports.
- Test files are compiled by `tsc -b` too, so they are type-checked; they end up in `dist/` but are never loaded.
- Migrations live in `packages/db/migrations/<module>/NNNN_name.ts` and are named `<module>/NNNN_name`; modules never add foreign keys to another module's tables, so cross-module order does not matter.
- Timestamps and EVE ids use `bigint` columns (Postgres `integer` is 32-bit); the pg driver parses int8 into a JS number. Use `col.*` from `@wormwright/db` in migrations.
- `Database` (from `@wormwright/db`) is the UnitOfWork: `transaction()` binds a Kysely transaction to AsyncLocalStorage and adapters always query through `database.db()`; nested transactions join the outer one.
- Per-stream `seq` comes from an `event_stream.head_seq` upsert inside the appending transaction; the row lock makes seq order equal commit order, and the head survives pruning.
- Events reach the EventBus through an `afterCommit` hook, so rolled back work never publishes.
- `*.updated` events carry the full DTO and `*.removed` events carry the id, so client reducers are simple upserts/deletes.
- A WS subscribe without `sinceSeq`, with a gap above 1000 events, with pruned history or with a seq ahead of the head gets a snapshot; otherwise the missing events are replayed.
- Snapshots are merged from every provider registered for the stream kind, read in one repeatable-read transaction.
- Subscriptions are authorized on subscribe and re-checked (with a re-resolved actor) after any `access.*` event on that stream or the instance stream.
- The `instance` stream is open to any signed-in account by default; modules may replace that authorizer.
- Use cases throw `DomainError` subclasses (`@wormwright/core`); `Result` is for pure functions such as parsers. The HTTP edge maps error codes to 400/401/403/404/409.
- Every non-2xx JSON body is `{ error: { code, message, details? } }` (`ApiErrorBody` in shared).
- Every Nest constructor parameter uses an explicit `@Inject(token)`, so DI never depends on emitted decorator metadata (tests run through Vite).
- REST paths live in `packages/shared/src/routes.ts`; Nest uses the global prefix `api` and controllers declare `nestPath(routes.x.y.path)`.
- `MapAccess` (role of an actor on a map) is a core port implemented by the access module; `requireMapRole` reports maps the actor cannot view as not found so ids do not leak.
- Map role resolution: a `blocked` rule on a character or account wins; otherwise the highest granting role; otherwise `blocked` if only blocks matched.
- Instance owners and admins are treated like any account on maps unless the access module decides otherwise.
- Cross-module needs are ports owned by the consumer (`AccessSubjectsSource`, `MapOwnership`, `CharacterTokenSource`) and composed in `apps/server/src/adapters/`.
- Without `SECRET_KEY` the server generates one and keeps it in `DATA_DIR/secret.key`, so a bare `docker run` works.
- `DATABASE_URL` must be a `postgres://` URL when set; anything else is a startup error rather than a silent SQLite fallback.
- `event_log` retention defaults to 30 days, pruned hourly; it becomes an admin setting later.
- Connection vocabulary: time `normal|eol` (< 4 h), mass `fresh|reduced|critical` (> 50 %, 10-50 %, < 10 %), ship size `small|medium|large|xlarge`, bubbled `none|source|target|both`.
- System status values: `unknown, home, friendly, empty, occupied, warning, hostile`; signature groups: `unknown, wormhole, combat, relic, data, gas, ore`.
- `whClass` is the SDE wormhole class id (1-6 C1-C6, 7/8/9 high/low/null, 12 Thera, 13 shattered, 14-18 Drifter, 25 Pochven).
- For the MVP the mapping entities have the same shape as their DTOs; split them when they diverge.
- `plugin-sdk` depends only on core and shared types; plugin ports are narrow facades (`maps`, `universe`, `events`, `notifier`, `clock`).
- The built SPA is served by `@fastify/static` without wildcard plus a catch-all that returns `index.html` (JSON 404 under `/api`); hashed assets are cached for a year.
- The default theme is light; without a stored choice the web app follows `prefers-color-scheme` and picks `dark`.
- Import boundaries are enforced by a small local ESLint rule (`tools/eslint/boundaries.js`) instead of a plugin.
- Feature modules register themselves with one line each in `apps/server/src/modules/index.ts`.
- The dev compose file has a `dev` service for commands and an `app` service that runs `pnpm dev` on random loopback ports; `DEV_LOGIN=true` there.
