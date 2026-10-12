# The Darkbeacon API

Everything the web app does goes through the same REST API, and integrations use it too: bots that post
the chain somewhere, scripts that paste signatures, dashboards, AI agents (see [`mcp.md`](mcp.md)).

- **Reference**: `/api/docs` on your instance (Scalar, served by the instance itself; nothing is loaded
  from a CDN).
- **OpenAPI 3.1**: `/api/openapi.json`. **AsyncAPI 3.0** (WebSocket protocol and webhook payloads):
  `/api/asyncapi.json`.
- Both are generated from the contract in `packages/shared` (`routes.ts` and the zod schemas of the
  DTOs), so they cannot drift from what the server does. A test fails when a route has no scope, no
  response schema or is not documented, and another when the server serves a route the contract does not
  list.

## Versions

Use `/api/v1/...`. It is the stable, versioned prefix; `/api/...` is the same API without a version and
always follows the newest one (the web app uses it).

- `info.version` of the description is the version of the contract (semver). Additive changes (a new
  route, a new optional field, a new event type) raise the minor version and do not change the prefix.
- A breaking change ships under a new prefix (`/api/v2`). The old prefix keeps working for at least six
  months; its operations are marked `deprecated` in the description and answered with a
  `Deprecation: true` header (and `Sunset` once the date is set). Release notes say what changes.
- Readers must ignore fields and event types they do not know.

## Authentication

| Who                      | How                                         | Where                   |
| ------------------------ | ------------------------------------------- | ----------------------- |
| The web app              | the `dbk_session` cookie (same origin only) | browser                 |
| A person's script or bot | a **personal access token** `dbk_pat_…`     | `Authorization: Bearer` |
| A shared integration     | a **service key** `dbk_svc_…`               | `Authorization: Bearer` |
| Anyone                   | nothing, for `none` routes and public maps  |                         |

Personal access tokens are made in **Account → API keys**. They act as the account that made them and can
only ever narrow what it may do: every request runs through the same use cases and permission checks as
the web app, with the account's own map roles, lowered to what the key's scopes allow. If the account
loses a role, so does the key.

Service keys are made by instance admins in **Admin → API access**. They are their own principal: a name,
an instance role (`user` or `admin`) and roles on the maps the admin picks (or on every map), narrowed by
their scopes in the same way.

Both kinds have:

- **Scopes** (below), required.
- **Expiry** (optional), an **IP allow-list** of addresses and CIDR ranges (optional, IPv4 and IPv6), a
  **rate limit** in requests a minute (default 300) and a **read-only** switch (only `GET` requests and
  read tools, whatever the scopes say).
- **Last used** time and address, shown in the lists. **Rotate** replaces the secret (the old one stops
  working at once, everything else stays); **revoke** ends the key. Admins can revoke any key.

Keys are managed from a browser session only: a key can never make, list, rotate or revoke keys.

### Token format

```
dbk_pat_<lookup:12><secret:32><checksum:6>      personal access token
dbk_svc_<lookup:12><secret:32><checksum:6>      service key
```

All parts are base62. The token is shown once. The server keeps the lookup part (to find the key) and an
HMAC-SHA256 of the secret part with a pepper derived from `SECRET_KEY`; the checksum is CRC32 of everything
before it. OAuth tokens of MCP clients (`dbk_oat_`, `dbk_ort_`, see [`mcp.md`](mcp.md)) have the same shape. Secret
scanners can match `\bdbk_(pat|svc|oat|ort)_[0-9A-Za-z]{50}\b` and verify the checksum. A leaked
token? Revoke it in the web app; that takes effect on the next request.

## Scopes

A scope is `<resource>:<action>`, which applies to every map the principal reaches, or
`map:<mapId>:<resource>:<action>`, which applies to one map; `map:<mapId>:*` is everything on one map.
Actions are ordered: `manage` includes `write`, `write` includes `read`; `*` stands for every resource or
every action.

| Resource      | read                         | write                             | manage                    |
| ------------- | ---------------------------- | --------------------------------- | ------------------------- |
| `maps`        | list and open maps           | labels, bookmark template         | settings, sharing, delete |
| `systems`     | (in snapshots) notes, status | add, move, edit, notes, remove    | lock                      |
| `connections` | connection intel, passages   | add, edit, remove                 |                           |
| `signatures`  | list                         | add, paste, edit, remove          |                           |
| `routes`      | routes, exits, hubs          | the map's hubs                    |                           |
| `tracking`    | tracked characters           | track own characters              |                           |
| `audit`       | the map's history and export | revert a change                   |                           |
| `webhooks`    |                              |                                   | the map's webhooks        |
| `access`      |                              |                                   | the map's access rules    |
| `account`     | own profile, landing         | main character, default map, hubs |                           |
| `universe`    | static game data             |                                   |                           |

`admin:read`, `admin:write` and `admin:*` are instance administration; only instance admins can give them
to a key, and a key never acts as the instance owner (ownership is transferred in the web app).
`federation:*` is reserved for instance-to-instance sharing and refused today.

Routes that need a browser session (sign-in, sessions, API key management, the Discord bot token, plugin
pages, presence) refuse every key. Every operation in the reference lists its scope, the minimum map role
and whether keys may call it. The WebSocket follows a map stream with a key only when the key reads
everything on that map (`*:read` or `map:<id>:*`), the instance stream with `account:read`.

Examples:

```
maps:read                                   see every map the account sees
*:read                                      read everything, write nothing
map:0193...:signatures:write                paste signatures on one map
map:0193...:*                               everything the account may do on one map
systems:write connections:write signatures:write *:read      a mapping bot
```

## Errors and limits

Every error is `{ "error": { "code", "message", "details"? } }`.

- `401 unauthenticated`: no session, or the key is unknown, malformed, expired, revoked or used from an
  address outside its allow-list. With a key, the answer carries
  `WWW-Authenticate: Bearer realm="darkbeacon", error="invalid_token", error_description="…"`.
- `403 forbidden`: the role or the scopes do not allow it. A missing scope is
  `WWW-Authenticate: Bearer error="insufficient_scope", scope="signatures:write"` and
  `details.requiredScope`.
- `404 not_found`: also maps the caller cannot see, so ids do not leak.
- `429 rate_limited` with `Retry-After`: a key over its limit, too many invalid tokens from one address
  (ten a minute, then refused for a while), or too many anonymous public reads.

## Examples

```sh
DBK=https://map.example.com
TOKEN=dbk_pat_...

# Maps the key can see
curl -s -H "Authorization: Bearer $TOKEN" $DBK/api/v1/maps

# A map's connections, most urgent first, with mass and time left
curl -s -H "Authorization: Bearer $TOKEN" $DBK/api/v1/maps/$MAP/connections/intel

# Paste the probe scanner (needs signatures:write)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"text": "ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.2 AU", "mode": "merge"}' \
  $DBK/api/v1/maps/$MAP/systems/31000005/signatures/paste

# Route from a system to Jita in outlaw mode, skipping EOL holes
curl -s -H "Authorization: Bearer $TOKEN" \
  "$DBK/api/v1/maps/$MAP/route?from=31000005&to=30000142&mode=outlaw&skip=eol"

# A missing scope
curl -si -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"solarSystemId": 30000142}' $DBK/api/v1/maps/$MAP/systems
# HTTP/1.1 403 Forbidden
# www-authenticate: Bearer realm="darkbeacon", error="insufficient_scope", ..., scope="systems:write"
```

Changes made with a key show in the map's history as the account (or the service key) "via key <name>".

## Realtime and webhooks

- **WebSocket** `/ws`: `{"op":"subscribe","stream":"map:<id>","sinceSeq":<n>}`, then `event` messages; see
  the AsyncAPI description. Browsers authenticate with the cookie (same origin only); other clients send
  `Authorization: Bearer <key>` on the upgrade request.
- **Webhooks** (per map, Map settings → Notifications): every chosen event is POSTed as the event envelope
  with `x-darkbeacon-signature: sha256=<hex>` = HMAC-SHA256 of `<x-darkbeacon-timestamp>.<raw body>` with
  the webhook secret. The payload of each event type is in `webhooks` and `components.schemas.Event_*` of
  the OpenAPI description.
- **Server-Sent Events** `GET /api/streams/map:<id>/sse`: the same subscription as the WebSocket, for
  clients that only read. Frames are `event: <type>`, `id: <seq>`, `data: <event envelope>`; reconnecting
  with `Last-Event-ID` (or `?sinceSeq=`) resumes without gaps. Without either the stream starts at the
  newest event (`?snapshot=true` sends a `snapshot` frame first). `?types=system.*,connection.*` filters.
  At most 20 open streams per address and 10 per key.
- **Events since** `GET /api/maps/:mapId/events?sinceSeq=<n>&limit=<1-1000>&types=`: a page of the map's
  events after a seq, oldest first, with `nextSeq`, `headSeq`, `more`, and `gap` when the log no longer
  holds what came after `sinceSeq` (read the snapshot again).

## Batches and connections by their systems

- `POST /api/maps/:mapId/batch` with `{"systems":[{"solarSystemId":…, …fields}], "connections":[{"source":…,
"target":…, …fields}]}` adds or changes everything in one transaction: all of it, or nothing when one
  change is refused.
- `POST /api/maps/:mapId/batch/delete` with `{"systems":[ids], "connections":[id or {"source","target"}]}`.
- `GET | PATCH | DELETE /api/maps/:mapId/connections/between/:source/:target` (either direction).

## Map files

`GET /api/maps/:mapId/export` (managers; `?accessRules=true` for admins) downloads the map as a
`darkbeacon.map` v1 file: everything on it, hidden systems with their notes included. `POST
/api/maps/import` with `{"document": <file>}` makes a new map from it (send files over 1 MB as
`content-type: application/vnd.darkbeacon.map+json`, up to 32 MB). `POST /api/maps/:mapId/duplicate`
does both in one step. `GET /api/maps/:mapId/settings/export` and `POST …/settings/import` carry the
settings and labels alone.

## Wanderer-compatible API

Bots written for Wanderer's public map API keep working against Darkbeacon with two changes: the base
URL, and the key.

| Wanderer                                | Darkbeacon                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Map API key (Map settings → Public API) | An API key (Account → API keys, or a service key from Admin → API access) with the scope `map:<map id>:*:read` |
| `?map_id=<uuid>`                        | `?map_id=<Darkbeacon map id>`, or `?slug=<map address>` as before                                              |

Answered, read-only, in Wanderer's JSON shapes and errors (`{"error": "…"}`):
`GET /api/map/systems`, `/api/map/system?id=<solar system id>`, `/api/map/connections`,
`/api/map/characters`, `/api/map/user_characters`, and `GET /api/maps/<id or slug>/systems`,
`/connections`, `/tracked-characters`. Statuses, mass, time, size and type are Wanderer's integers;
`labels` is the JSON string Wanderer's map writes, with Darkbeacon label names.

`GET /api/maps/<id or slug>/events/stream` is Wanderer's SSE stream: a `connected` frame, then
`event: <wanderer type>`, `id: <ULID>`, `data: {"id","type","map_id","timestamp","payload"}`; `events=`
filters by Wanderer names, `last_event_id=<ULID>` sends the events after it first (the last 1000).
Darkbeacon events map to `add_system`, `deleted_system`, `system_metadata_changed`,
`connection_added|updated|removed`, `character_added|removed`, `signature_added|removed` and
`acl_member_added|updated|removed` (character, corporation and alliance rules). Kills and rally points
come when Darkbeacon has them. Writes, structure timers, audit and ACL endpoints of Wanderer's API are not
answered: use Darkbeacon's own.

## Browsers on other sites (CORS)

Off by default. An admin can allow origins (`https://tools.example.com`) in **Admin → API access**; those
origins may call the API and `/mcp` from a browser with an API key. Credentials are never allowed
cross-origin and the server ignores cookies on cross-origin requests, so a visitor's session can never be
used from another site. Sessions keep their protection (SameSite=Lax, same-origin checks); nothing about
them changed.
