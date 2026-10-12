# Moving from Wanderer

Darkbeacon imports whole Wanderer maps: systems with their notes, tags, labels and positions, connections in
every state, signatures, structures, system comments and the map's access lists. It reads the public
instance (wanderer.ltd) and any self-hosted Wanderer, over Wanderer's API with a map API key or from the file
Wanderer exports. The import runs on the server, can be merged into a map you already use, and can keep
pulling from Wanderer while your group moves over.

Darkbeacon is written from scratch; it only speaks Wanderer's published API and file format (see
[Sources](#sources)).

## Step by step

1. **Get the map API key in Wanderer.** Open the map, then its settings, and find the **Public API** section
   (Wanderer calls it the map API key). Generate one if the map has none and copy it. On a self-hosted
   Wanderer (Community Edition) the public API must be switched on: `WANDERER_PUBLIC_API_DISABLED=false`.
   Access lists whose members the map key cannot read need their own **ACL API key** (from the ACL's edit
   screen in Wanderer); the preview tells you which ones.
2. **Open the import in Darkbeacon.** Go to **All maps** and press **Import from Wanderer**, or, to merge into
   a map you have already, open that map's settings, **Import**, **Import into this map**.
3. **Choose the source.**
   - **Wanderer's API**: the address of the instance (`https://wanderer.ltd` or your own), the map (its slug,
     or paste the map's address) and the map API key. **Test connection** checks the address and the key
     without reading anything else.
   - **Export file**: the `.json` file Wanderer exported (up to 25 MB). A file is read once; it cannot keep
     syncing, and it has no access lists.
4. **Read the map.** Darkbeacon reads the whole map and shows a preview: how many systems (shown and hidden),
   connections, signatures, structures, comments, labels, access rules and hubs it found, and the mapping
   report: what comes over as it is, what comes over close to it, and what is left out and why. Nothing is
   written yet. The access list shows every ACL member with the role it will get here and the name ESI gives
   it today (or the name Wanderer had, when ESI does not know it).
5. **Choose where it goes.**
   - **A new map**: you name it and become its owner; everything is created as Wanderer has it.
   - **A map I manage**: merged field by field (see [Merging](#merging)). The preview shows what would be
     new, updated, unchanged or skipped, and every field the two sides disagree on with the side that is kept.
   - Options: **Import access rules** (map admins), **Remove what Wanderer no longer has** (merges only) and
     **Keep syncing from Wanderer** (API only, every 5 to 60 minutes).
6. **Import.** The import runs as a job on the server; the page follows it live (progress per phase). A job
   interrupted by a restart picks up where it was. When it is done, **Open map** and **Download report** (the
   job, the mapping report, what happened per kind, and the Wanderer fields Darkbeacon has no place for).
7. **While you move over**, a map that keeps syncing pulls Wanderer again every N minutes and merges what
   changed. Stop it in the map's settings, **Import**, **Stop syncing**. It also stops by itself when Wanderer
   refuses the key, after five failed pulls in a row, or when the person who set it up is no longer a manager
   of the map.

## Public and self-hosted Wanderer

- **wanderer.ltd** and other public instances are read over `https://` only.
- A **self-hosted Wanderer on your own network** (a private or local address, or plain `http://`) is refused
  until an instance admin allows it: **Admin**, **Instance**, **Imports**, **Allow imports from private
  networks**. The check runs when the connection is made, so a name that resolves to a private address is
  refused too.
- A self-hosted Wanderer with a **self-signed certificate**: an instance admin can tick **Accept a
  self-signed certificate** on the import page.
- Darkbeacon never follows redirects with the key (it tells you the address to use instead), waits out
  `429` answers (`Retry-After`), retries `5xx` answers and network errors twice, and spaces its requests to
  one instance. Every person can read at most twelve Wanderer maps in ten minutes, one at a time.

## What migrates

| Wanderer                                                                                  | Darkbeacon                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Systems: position, custom name, temporary name, tag, notes, locked, shown or hidden       | The same fields. Hidden systems come over hidden, with their notes and signatures. Positions are spread to fit Darkbeacon's larger systems (once; later pulls keep the same scale). |
| Status: unknown, friendly, warning, home, target (primary)                                | The same status.                                                                                                                                                                    |
| Status: target (secondary), dangerous (primary and secondary)                             | Target, Hostile (close to it).                                                                                                                                                      |
| Status: looking for                                                                       | Unknown, with a "Looking for" label.                                                                                                                                                |
| Labels (A, B, C, 1, 2, 3, the map's own labels, a system's custom label)                  | Map labels with those names, on the same systems.                                                                                                                                   |
| Connections: wormhole, gate, bridge                                                       | Wormhole, gate, bridge.                                                                                                                                                             |
| Mass: more than half, less than half, critical                                            | Fresh, reduced, critical; the time it was set counts for mass estimates.                                                                                                            |
| Time: EOL 1 h, 4 h, 4.5 h                                                                 | End of life, timed so the hours left match what Wanderer showed when it was marked.                                                                                                 |
| Ship size: frigate, medium, large, freight, capital                                       | Frigate (`F`), medium, large, XL (freight becomes XL).                                                                                                                              |
| Dangerous, bubbled (source, target, both)                                                 | The same.                                                                                                                                                                           |
| When a connection was found                                                               | Kept, so lifetimes count from Wanderer's first sighting.                                                                                                                            |
| Signatures (cosmic signatures, every group), names, notes, wormhole types, linked systems | Signatures; one that leads to a system the map connects is linked to that connection. A connection's wormhole type goes to its signature.                                           |
| Structures (type, name, owner, status, timer, notes)                                      | Listed in the system's notes ("Structures (from Wanderer)").                                                                                                                        |
| System comments                                                                           | Listed in the system's notes ("Comments (from Wanderer)"), with their dates.                                                                                                        |
| ACL members: characters, corporations, alliances                                          | Access rules on the map by EVE id (see [Access](#access)).                                                                                                                          |
| Map scope (wormholes, stargates, all, none)                                               | Auto-mapping scopes.                                                                                                                                                                |
| Map hubs (settings export)                                                                | Map hubs (up to 20).                                                                                                                                                                |

## What does not migrate

- **Tracked characters and user settings.** Each pilot signs in with EVE and links their characters here.
- **Cosmic anomalies, ships, structures and other non-signature scanner rows** (Darkbeacon keeps cosmic
  signatures only) and signatures without a full `ABC-123` id.
- **Lifetime marks of 16, 24 and 48 hours**: Darkbeacon works a hole's lifetime out from its wormhole type
  and when it was found.
- **Locks on connections** (Darkbeacon locks systems), **connection notes** (`custom_info`) and **passage
  counts**: kept in the import record and the downloadable report (`importedExtra`), not on the map.
- **The bookmark name of a signature** goes into the signature's description ("Bookmark: …").
- **Connections to hidden systems** (a hidden system has no connections here) and a second connection
  between the same two systems.
- **Kills, routes, webhooks, map subscriptions and licences.**
- **ACLs whose members the map key cannot read**, unless you give their ACL API keys.
- The map's description.

The mapping report of every import lists exactly what was approximated and left out, with examples.

## Merging

A merge never deletes anything unless you ask for it, and it is idempotent: running the same import again
changes nothing, because every imported object keeps a stable id from Wanderer (solar system id, the pair of
systems of a connection, system and signature id, the subject of an access rule).

- **First import into an existing map**: blanks here are filled from Wanderer, blanks in Wanderer change
  nothing, and where both have a different value the newer side wins (Wanderer's `updated_at` against the
  time the object last changed here). Notes and labels are never lost: different notes are joined, labels
  are united.
- **Later imports and syncs from the same source** are three-way merges against what the last import wrote:
  a field only Wanderer changed is taken, a field only changed here is kept, a field both changed goes to the
  newer side.
- A system **locked** here keeps its position. A system Wanderer took off its map is hidden here only when
  **Remove what Wanderer no longer has** is on.
- **Removals** (asked for) remove only what an earlier import brought and nobody changed here since.
- **Access rules**: a subject without a rule gets one; a rule an earlier import added and nobody changed
  follows Wanderer's role; any other rule here is kept as it is.

## Access

| Wanderer ACL role | Map role here                         |
| ----------------- | ------------------------------------- |
| admin             | admin (map settings and access rules) |
| manager           | manager                               |
| member            | member (edits the chain)              |
| viewer            | viewer                                |
| blocked           | blocked                               |

A subject in several ACLs gets its strongest role. A block on a character beats every grant (as in
Darkbeacon), while a block on a corporation or alliance yields to grants from other rules; the preview says
so. Access rules only grant map roles: an import never makes anyone an instance admin. Importing access
rules needs a map admin; the person who imports into a new map is its owner. Wanderer's map owner is not
carried over.

## Audit

Every change an import makes is an ordinary event on the map (clients, webhooks and plugins see it like any
edit) and goes into the audit trail as the person who ran the import, through the channel
**"Imported from Wanderer `<host>/<slug>`"**. The map's history shows when an import started and finished
(`import.started`, `import.finished`) and when syncing was switched on or off (`import.sync_changed`). The
API key is stored encrypted (AES-256-GCM) and never shown or recorded again.

## API

The import screen uses these routes (signed-in accounts):

- `POST /api/imports/wanderer/test`, `POST /api/imports/wanderer` (API source),
  `POST /api/imports/wanderer/file` (the export file as the body, content type
  `application/vnd.darkbeacon.wanderer-export+json`)
- `GET /api/imports/:jobId`, `POST /api/imports/:jobId/plan`, `POST /api/imports/:jobId/start`,
  `POST /api/imports/:jobId/cancel`, `GET /api/imports/:jobId/report`
- `GET` and `DELETE /api/maps/:mapId/import-sync`
- Progress over the WebSocket: subscribe to `import:<jobId>` (`import.progress` events with the whole job).

## Sources

Wanderer's API and formats as documented by the Wanderer team, read for interoperability only:

- [Comprehensive Guide: Wanderer API Documentation](https://wanderer.ltd/news/api): map API key and ACL API
  key (Bearer), `GET /api/map/systems?slug=&all=true`, `/api/map/connections`, `/api/map/acls`,
  `/api/acls/:id` (members with `eve_character_id`, `eve_corporation_id` or `eve_alliance_id`),
  `/api/map/characters`.
- [API Guide: Systems and Connections API](https://wanderer.ltd/news/systems-connections-api):
  `/api/maps/:map/systems`, `/connections`, `/signatures`, `/structures` and their fields.
- [API Modernization: JSON:API v1](https://wanderer.ltd/news/api-modernization): `/api/v1/*` resources,
  offset pagination (`page[limit]`, `page[offset]`), `map_system_comments` and `map_system_signatures`.
- [User Guide: Public API Endpoints for Map Data](https://wanderer.ltd/news/map-public-api): where the map
  API key is generated (map settings).
- [User Guide: Characters & ACL API Endpoints](https://wanderer.ltd/news/acl-api) and the access lists guide
  ([GitHub](https://github.com/wanderer-industries/wanderer/blob/main/priv/posts/2024/08-04-access-lists-guide.md)):
  ACL roles admin, manager, member, viewer, blocked.
- Value codes (system status 0-8, connection type, mass, time and ship size codes, labels as JSON with
  `customLabel` and `labels`) as Wanderer's API schemas describe them
  ([swagger at `/swaggerui`](https://wanderer.ltd/swaggerui), resources in
  [wanderer-industries/wanderer](https://github.com/wanderer-industries/wanderer)), and the export
  files the Wanderer UI writes (the map settings export and the map contents export, versions 1 and 2).

The fake Wanderer used by the tests and the demo (`tools/fake-wanderer`) serves made-up data in these
shapes; nothing is ever sent to wanderer.ltd by the tests.
