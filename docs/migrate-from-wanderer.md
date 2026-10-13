# Moving from Wanderer

Darkbeacon imports whole Wanderer maps: systems with their notes, tags, labels and positions, connections in
every state, signatures, structures, system comments and the map's access lists. It reads the public
instance (wanderer.ltd) and any self-hosted Wanderer, over Wanderer's API with a map API key, from the file
Wanderer exports, or (instance admins, for your own Wanderer) straight from Wanderer's database. The import
runs on the server, can be merged into a map you already use, and can keep pulling from Wanderer while your
group moves over.

Darkbeacon is written from scratch; it speaks Wanderer's API, file format and tables as a running Wanderer
answers with them (see [Sources](#sources)).

## Step by step

1. **Get the map API key in Wanderer.** Open the map, then its settings, and find the **Public API** section
   (Wanderer calls it the map API key). Generate one if the map has none and copy it. On a self-hosted
   Wanderer (Community Edition) the public API must be switched on: `WANDERER_PUBLIC_API_DISABLED=false`.
   Our Wanderer gives the members of every ACL on the map to the map key; on one that does not, those ACLs
   need their own **ACL API key** (from the ACL's edit screen in Wanderer), and the preview tells you which.
2. **Open the import in Darkbeacon.** Go to **All maps** and press **Import from Wanderer**, or, to merge into
   a map you have already, open that map's settings, **Import**, **Import into this map** (map managers).
3. **Choose the source.**
   - **Wanderer's API**: the address of the instance (`https://wanderer.ltd` or your own), the map (its slug,
     or paste the map's address) and the map API key. **Test connection** checks the address and the key
     without reading anything else.
   - **Export file**: the `.json` file Wanderer exported (up to 25 MB). A file is read once; it cannot keep
     syncing, and it has no access lists.
   - **From Wanderer's database** (instance admins): a Postgres connection string to your own Wanderer's
     database (a read-only role is enough), **List maps**, then the map. Everything is read with SELECTs in one
     read-only transaction, nothing is ever written there, and the connection string is kept encrypted.
     This brings what Wanderer's API cannot: every comment's author, passages one by one, and the map's
     label names and hidden systems on a Wanderer without the map export. Give the Wanderer's address too,
     and imports from its database and its API count as one source.
4. **Read the map.** Darkbeacon reads the whole map and shows a preview: how many systems (shown and hidden),
   connections, signatures, structures, comments, labels, access rules and hubs it found, and the mapping
   report: what comes over as it is, what comes over close to it, and what is left out and why. Nothing is
   written yet. The access list shows every ACL member with the role it will get here and the name ESI gives
   it today (or the name Wanderer had, when ESI does not know it).
5. **Choose where it goes.**
   - **A new map**: you name it and become its owner; everything is created as Wanderer has it.
   - **A map I manage** (not a map that merges other maps): merged field by field (see [Merging](#merging)). The preview shows what would be
     new, updated, unchanged or skipped, and every field the two sides disagree on with the side that is kept.
   - Options: **Import access rules** (map admins), **Remove what Wanderer no longer has** (merges only) and
     **Keep syncing from Wanderer** (API or database, every 5 to 60 minutes).
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

Everything a Wanderer map holds comes over 1:1. Where Darkbeacon had no place for something, it has one now
(connection notes, locks and lifetime marks; anomalies and other scanner results; custom entries).

| Wanderer                                                                                          | Darkbeacon                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Systems: position, custom name, temporary name, notes, locked, shown or hidden                    | The same fields. Hidden systems (taken off Wanderer's map) come over hidden, with their notes, labels, tag, status, signatures, structures and comments, there when the system shows up again. Positions are spread to fit Darkbeacon's larger systems (once; later pulls keep the same scale).                                                                                                                                   |
| The map's labels (its own list, e.g. WH-ST, WH1, WH2...)                                          | The map's **Labels**, in the same order with the same ids and descriptions (names up to 8 characters; colours dropped, Labels are plain text; two with one name become one). A new map takes Wanderer's list instead of WH1-WH3; a merge adds the ones the map lacks by name. A source that does not give the list (a Wanderer without the map export, an old export file) names each label after its id, and the report says so. |
| A system's labels and its custom label                                                            | The system's Labels and its custom label (up to 16 characters).                                                                                                                                                                                                                                                                                                                                                                   |
| A system's tag                                                                                    | A **Tag** of that name on the system (created in the map's Tags, grey, when missing).                                                                                                                                                                                                                                                                                                                                             |
| Status: clear, home, friendly, warning, target, dangerous                                         | Unknown, home, friendly, warning, target, hostile. (Wanderer stores them as 0 clear, 1 home, 2 friendly, 3 looking for, 4 warning, 5 target, 6 dangerous, the numbers its map sets.)                                                                                                                                                                                                                                              |
| Status: looking for                                                                               | Unknown, with a "Looking for" Tag.                                                                                                                                                                                                                                                                                                                                                                                                |
| Connections: wormhole, gate, bridge                                                               | Wormhole, gate, bridge.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Mass: more than half, less than half, critical                                                    | Fresh, reduced, critical; the time it was set counts for mass estimates.                                                                                                                                                                                                                                                                                                                                                          |
| Time marks: less than 1 h, 4 h, 4.5 h, 16 h, 24 h, 48 h left                                      | The connection's lifetime mark with the time it was set (the time left and the hover card count from it); 1 h and 4 h are also end of life.                                                                                                                                                                                                                                                                                       |
| Ship size: frigate, medium, large, freight, capital                                               | Frigate, medium, large, freighter (XL), capital.                                                                                                                                                                                                                                                                                                                                                                                  |
| Dangerous, bubbled (source, target, both)                                                         | The same.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Locked connections                                                                                | Locked connections: only map managers change or remove them, auto-mapping never does.                                                                                                                                                                                                                                                                                                                                             |
| Connection custom info                                                                            | The connection's note. A wormhole type that no signature carries is added to it ("Wormhole type: U210").                                                                                                                                                                                                                                                                                                                          |
| When a connection was found, when anything last changed                                           | Kept: lifetimes count from Wanderer's first sighting, and shared chains weigh changes by Wanderer's own times.                                                                                                                                                                                                                                                                                                                    |
| Cosmic signatures (every group), names, notes, wormhole types, linked systems                     | Signatures; one that leads to a system the map connects is linked to that connection. A connection's wormhole type goes to its signature.                                                                                                                                                                                                                                                                                         |
| Cosmic anomalies and other scanner rows (ships, structures, deployables, drones)                  | Scan results of kind anomaly or other, in the signatures section under "Anomalies and other results".                                                                                                                                                                                                                                                                                                                             |
| Custom signatures (ids that are not `ABC-123`, entries someone wrote)                             | Custom entries with their own id.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Marks on an unlinked signature (time, mass, where it leads)                                       | Written in its description ("Wanderer marks: less than 16h left, leads to C5").                                                                                                                                                                                                                                                                                                                                                   |
| The bookmark name of a signature                                                                  | Written in its description ("Bookmark: 1a"); Darkbeacon names bookmarks from the map's template.                                                                                                                                                                                                                                                                                                                                  |
| Passages one by one (pilot, ship, time), where the source lists them                              | Passages of the connection, with the ship's hull mass from the SDE; recorded once however often you import.                                                                                                                                                                                                                                                                                                                       |
| Structures (type, name, owner, status, timer, notes, who added it)                                | Structures of the system (Structures section): type, name, owner corporation and ticker, status, timer, notes, who added it and when. Statuses Darkbeacon has no value for become Powered (reported).                                                                                                                                                                                                                             |
| System comments                                                                                   | Comments of the system (Comments section), with who wrote them and when; cut to 500 characters (reported).                                                                                                                                                                                                                                                                                                                        |
| ACL members: characters, corporations, alliances                                                  | Access rules on the map by EVE id (see [Access](#access)).                                                                                                                                                                                                                                                                                                                                                                        |
| Map scope (wormholes, stargates, all, none)                                                       | Auto-mapping scopes.                                                                                                                                                                                                                                                                                                                                                                                                              |
| The map's hubs (`maps_v1.hubs`, an export's `hubs`), the hubs each user set for their User Routes | Map hubs, after the trade hubs every map has, none twice, up to 20 (wormholes too); each user's own hubs go to the account that has linked their main character. Wanderer's API gives no map hubs: over the API the map takes the hubs its users set, and the import says so; import from the database for the map's own.                                                                                                         |
| The map's description                                                                             | The map's description (Map settings, General), shown in the list of maps.                                                                                                                                                                                                                                                                                                                                                         |
| Webhook subscriptions (address and events)                                                        | Webhooks of the map, **added switched off** with the Darkbeacon events that tell the same thing (see [Webhooks](#webhooks)).                                                                                                                                                                                                                                                                                                      |

## What does not migrate, and why

- **Tracked characters and user settings.** Each pilot signs in with EVE and links their characters here;
  tracking starts again live.
- **Passage counts without details** (over the API). Wanderer's API says how many ships went through a
  connection, not who, in what or when. A bare count cannot feed mass estimates (they need the hull), so it
  is kept in the import record and the downloadable report (`importedExtra`). Wanderer's database and export
  files that list passages one by one bring them as passages.
- **Who wrote a comment** (over the API), unless Wanderer still tracks that pilot on the map: its API names
  comment authors by Wanderer's own character id only. Wanderer's database brings every author.
- **Connections to hidden systems** and a second connection between the same two systems: a hidden system
  has no connections in either mapper, and a pair of systems has one connection.
- **Kills.** They are zKillboard data that Darkbeacon reads live for the systems on the map.
- **Webhook events Darkbeacon does not send**: `map_kill` (kills are read live from zKillboard) and any event
  Wanderer adds later; the report names them. Wanderer's webhook secrets are never read.
- **Map subscriptions and licences.** They are the Wanderer service's billing, not part of the chain.
- **ACLs whose members the map key cannot read** (a Wanderer without JSON:API), unless you give their ACL API
  keys. Our Wanderer gives every ACL of the map with its members to the map key.

The mapping report of every import lists exactly what came over, what was approximated and what was left out,
with examples.

## Merging

A merge never deletes anything unless you ask for it, and it is idempotent: running the same import again
changes nothing, because every imported object keeps a stable id from Wanderer (solar system id, the pair of
systems of a connection, system and signature id, the subject of an access rule).

- **First import into an existing map**: blanks here are filled from Wanderer, blanks in Wanderer change
  nothing, and where both have a different value the newer side wins (Wanderer's `updated_at` against the
  time the object last changed here). Notes, Labels and Tags are never lost: different notes are joined, Labels and Tags
  are united.
- **Later imports and syncs from the same source** are three-way merges against what the last import wrote:
  a field only Wanderer changed is taken, a field only changed here is kept, a field both changed goes to the
  newer side.
- Imported changes carry Wanderer's own change times, so maps that merge this one (shared chains) weigh
  them by when they happened in Wanderer, and imported wormholes are numbered like any other.
- A system **locked** here keeps its position. A system Wanderer took off its map is hidden here only when
  **Remove what Wanderer no longer has** is on.
- **Removals** (asked for) remove only what an earlier import brought and nobody changed here since.
- **Access rules**: a subject without a rule gets one; a rule an earlier import added and nobody changed
  follows Wanderer's role; any other rule here is kept as it is.

## Webhooks

A Wanderer webhook comes over as a webhook of the map with the same address, switched off: Darkbeacon signs
every delivery with its own secret (header `x-darkbeacon-signature`) and sends its own event shapes, so the
receiver has to be set up for them first. In **Map settings, Webhooks** a map admin takes a **New signing
secret** (shown once), sets the receiver up with it, checks it with **Test** and switches the webhook on.
Events map like this:

| Wanderer                                                       | Darkbeacon                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `add_system`, `deleted_system`, `system_metadata_changed`      | `system.added`, `system.removed`, `system.updated`             |
| `connection_added`, `connection_removed`, `connection_updated` | `connection.added`, `connection.removed`, `connection.updated` |
| `signature_added`, `signature_removed`                         | `signature.added`, `signature.removed`                         |
| `signatures_updated`                                           | `signature.added`, `signature.updated`, `signature.removed`    |
| `acl_member_added`, `acl_member_removed`, `acl_member_updated` | `access.rule_added`, `access.rule_removed` (both for updated)  |
| `*` (or no events)                                             | `system.*`, `connection.*`, `signature.*`, access rule events  |
| `map_kill`                                                     | none (left out, see above)                                     |

Each Wanderer webhook is added once: a later import or sync does not add it again, even when it was deleted
here. Webhooks need a map admin.

## Access

| Wanderer ACL role | Map role here                         |
| ----------------- | ------------------------------------- |
| admin             | admin (map settings and access rules) |
| manager           | manager                               |
| member            | member (edits the chain)              |
| viewer            | viewer                                |
| blocked           | blocked                               |

A subject in several ACLs gets its strongest role, and one blocked in any ACL stays blocked. Blocks work as
in Wanderer: a block on a character beats every grant, a block on a corporation or alliance beats every
corporation and alliance grant, and only a rule on a character gets past it. Access rules only grant map roles: an import never makes anyone an instance admin. Importing access
rules needs a map admin; the person who imports into a new map is its owner. Wanderer's map owner is not
carried over.

## While a backup is restored

Imports and syncs pause while an admin restores a backup and carry on where they were afterwards.

## Audit

Every change an import makes is an ordinary event on the map (clients, webhooks and plugins see it like any
edit) and goes into the audit trail as the person who ran the import, through the channel
**"Imported from Wanderer `<host>/<slug>`"**. The map's history shows when an import started and finished
(`import.started`, `import.finished`) and when syncing was switched on or off (`import.sync_changed`). The
API key is stored encrypted (AES-256-GCM) and never shown or recorded again.

## API

The import screen uses these routes (signed-in accounts):

- `POST /api/imports/wanderer/test`, `POST /api/imports/wanderer` (API source),
  `POST /api/imports/wanderer-db/maps` and `POST /api/imports/wanderer-db` (database source, instance admins),
  `POST /api/imports/wanderer/file` (the export file as the body, content type
  `application/vnd.darkbeacon.wanderer-export+json`)
- `GET /api/imports/:jobId`, `POST /api/imports/:jobId/plan`, `POST /api/imports/:jobId/start`,
  `POST /api/imports/:jobId/cancel`, `GET /api/imports/:jobId/report`
- `GET` and `DELETE /api/maps/:mapId/import-sync`
- Progress over the WebSocket: subscribe to `import:<jobId>` (`import.progress` events with the whole job).

## Sources

Wanderer's API, formats and tables, read for interoperability only. What the importer reads was recorded
from a running instance of our Wanderer fork (upstream v1.103 with its additions), answer by answer, in
`tools/fake-wanderer/recorded/answers.json`; the database tables are the fork's
(`apps/server/src/adapters/importing/testdata/wanderer-schema.sql`). Over the API, with the map API key:

- `GET /api/maps/:map/systems`: the systems shown on the map (`{ data: { systems, connections } }`, the
  same answer on the old `/api/map/systems?slug=`), each with `name` as shown (temporary name first),
  `custom_name`, `original_name`, `labels` as JSON text, `status`, `visible`, `locked`, `position_x/y` and
  times; connections without notes, marks or passage counts.
- `GET /api/maps/:map/export` (our fork): the map's export document, version 2, with every system (hidden
  ones `visible: false`), the connections' `custom_info`, `dangerous` and `bubbled`, signatures, comments,
  structures and the map's `system_labels`. It is the only route with the map's label names.
- JSON:API under `/api/v1`, scoped to the key's map: `map_systems` (every system, hidden ones too, with
  Wanderer's ids, but no position, lock or `visible`), `map_connections` (notes, marks, `count_of_passage`,
  `mass_status_updated_at`), `map_system_signatures?include=system` (deleted ones too, skipped),
  `map_system_structures`, `map_system_comments?include=system,character` (the author as Wanderer's id
  only), `access_lists?include=members` (every ACL of the map with its members, no ACL key needed),
  `maps/:slug` (`scope`, `scopes`) and `map_user_settings` (`hubs`). Pages follow `links.next`, whose
  address Wanderer writes as it sees itself; only its path is followed. There is no `map_chain_passages`.
- `/api/maps/:map/signatures` and `/structures` (the shown systems' rows with their times),
  `/tracked-characters` (who wrote comments), `/webhooks` (403 in plain text when the instance has them
  switched off), `/api/map/acls?slug=` and `/api/acls/:id` (the ACL's own key only).
- Refusals: 401 `Unauthorized (invalid token for map)`, 401 in plain text when the map's subscription is
  not active, 403 `Public API is disabled`, 404 for an unknown map.
- System statuses as Wanderer's map sets and stores them (its frontend's `STATUSES`): 0 clear, 1 home,
  2 friendly, 3 looking for, 4 warning, 5 target, 6 dangerous. Wanderer's API docs and a comment in its
  resource list another numbering (target primary and secondary...) the app never writes.

Wanderer's public documentation, for the parts the above does not cover:

- [Comprehensive Guide: Wanderer API Documentation](https://wanderer.ltd/news/api): map API key and ACL API
  key (Bearer), `/api/acls/:id` (members with `eve_character_id`, `eve_corporation_id` or
  `eve_alliance_id`).
- [API Guide: Systems and Connections API](https://wanderer.ltd/news/systems-connections-api):
  `/api/maps/:map/systems`, `/connections`, `/signatures`, `/structures` and their fields.
- [API Modernization: JSON:API v1](https://wanderer.ltd/news/api-modernization): `/api/v1/*` resources,
  offset pagination (`page[limit]`, `page[offset]`), `map_system_comments` and `map_system_signatures`.
- [User Guide: Public API Endpoints for Map Data](https://wanderer.ltd/news/map-public-api): where the map
  API key is generated (map settings).
- [Real-Time Events API: Server-Sent Events and Webhooks](https://wanderer.ltd/news/webhooks): `GET
/api/maps/:map/webhooks` (`url`, `events`, `active`) and the event names; self-hosted instances need
  `WANDERER_WEBHOOKS_ENABLED`, without it there are no webhooks to read. The JSON:API `map_user_settings`
  resource (API modernization guide) carries each user's `hubs`.
- [User Guide: Characters & ACL API Endpoints](https://wanderer.ltd/news/acl-api) and the access lists guide
  ([GitHub](https://github.com/wanderer-industries/wanderer/blob/main/priv/posts/2024/08-04-access-lists-guide.md)):
  ACL roles admin, manager, member, viewer, blocked.
- Connection time marks: Wanderer's lifetime selector
  ([`WdLifetimeSelector.tsx`](https://github.com/wanderer-industries/wanderer/blob/main/assets/js/hooks/Mapper/components/ui-kit/WdLifetimeSelector.tsx))
  describes each code as "less than N hours remaining" (1, 4, 4.5, 16, 24, 48 h; 4.5 h the life of small
  holes, 48 h only a few C6 statics), set on the connection's `time_status`; the time it was set is the
  connection's `updated_at`. Scanner kinds and groups as its signature types name them (`Cosmic Signature`,
  `Cosmic Anomaly`, `Structure`, `Ship`...). Passages one by one come from Wanderer's database
  (`map_chain_passages_v1`) and from files that list them.
- Connection type, mass, time and ship size codes and labels as JSON with `customLabel` and `labels` (an
  empty id `""` occurs and is skipped), as Wanderer's resources in
  [wanderer-industries/wanderer](https://github.com/wanderer-industries/wanderer) describe them, and the
  export files the Wanderer UI writes (the map settings export and the map contents export, versions 1
  and 2).

The fake Wanderer used by the tests and the demo (`tools/fake-wanderer`) serves made-up data in the
recorded shapes (a contract test compares the two); nothing is ever sent to wanderer.ltd by the tests.
