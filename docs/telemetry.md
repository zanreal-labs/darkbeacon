# Telemetry

Darkbeacon is self-hosted by many EVE groups, and its maintainers otherwise have no idea how many instances
and players there are or which features matter. So production builds send **anonymous** usage statistics to
the maintainers' PostHog project. This page lists every field that can leave your server, how to turn it off,
and why it is built the way it is.

Everything that is sent is visible in **Admin > Instance > Anonymous telemetry > Preview what is sent**: the
daily heartbeat as it would be sent right now and the last 50 events that were sent since the server started.

## Turning it off

Any one of these stops everything (no request is made at all):

| How                                     | Where                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `TELEMETRY=off` (or `false`, `0`, `no`) | environment of the container                                                      |
| `DO_NOT_TRACK=1` (any value but `0`)    | environment, the [Console Do Not Track](https://consoledonottrack.com) convention |
| the switch in Admin > Instance          | stored in the database, recorded on the instance audit (`telemetry.changed`)      |
| no project key                          | builds without `DEFAULT_TELEMETRY_KEY` and without `TELEMETRY_POSTHOG_KEY`        |

Development and test servers (`NODE_ENV` other than `production`) never send anything. The environment always
wins over the admin switch: with `TELEMETRY=off` the switch is shown but cannot turn it back on. Browsers that
send Do Not Track or Global Privacy Control do not report their web app events either (the instance heartbeat
is not about them and still goes out).

The first time an admin opens the app on an instance that sends, a notice explains this and links here and to
the switch; it is shown once per admin.

## Configuration

| Variable                 | Default                                | Meaning                             |
| ------------------------ | -------------------------------------- | ----------------------------------- |
| `TELEMETRY`              | on                                     | `off` turns telemetry off           |
| `DO_NOT_TRACK`           | unset                                  | `1` turns telemetry off             |
| `TELEMETRY_POSTHOG_KEY`  | `DEFAULT_TELEMETRY_KEY` (in the build) | PostHog project API key (`phc_...`) |
| `TELEMETRY_POSTHOG_HOST` | `https://eu.i.posthog.com`             | PostHog ingestion host              |

The build default lives in one place: `packages/modules/telemetry/src/domain/defaults.ts`. While it is empty,
telemetry is inert and the admin card says "This build has no telemetry project key". A fork can point it at
its own project with `TELEMETRY_POSTHOG_KEY` and `TELEMETRY_POSTHOG_HOST`.

## What is never sent

No character, account, corporation or alliance names or ids, no system, region or map names or ids, no map
slugs, no IP addresses, no emails, no Discord ids, no user agents, no free text of any kind (names, notes,
signatures, bookmark templates, search terms). This is enforced, not just intended:

- Every event and every property is on an allow-list (`TELEMETRY_SERVER_EVENTS` in the telemetry module,
  `TELEMETRY_WEB_EVENTS` in `packages/shared/src/telemetry.ts`). Each property is an enum, a boolean, a count
  bucket or a small whole number; unknown events or properties are dropped (server) or refused with 400 (web).
- Behind the schemas, a second check refuses any string that is not a short lowercase token or that looks like
  an email, an IP address, a UUID or a long number, and any number that is not a whole count under 10 000 000
  (EVE ids are all larger, so a character or system id cannot pass even as a number).
- Browser events never go to PostHog directly: the web app posts them to this instance (`POST /api/telemetry/e`),
  which checks them against the same allow-list and forwards them from the server. No PostHog script, cookie or
  storage is ever in the browser, and the browser's IP and user agent never reach PostHog.
- Events are anonymous in PostHog: `$process_person_profile: false` (no person profiles), `$geoip_disable: true`
  (no GeoIP lookup) and `$ip: null`; a last filter in the sender strips `$ip`, GeoIP and `$set` properties.

### Identity

- **Instance id**: a random UUID generated on first start and stored in this instance's database
  (`telemetry_state`). It is shown on the admin card. It is the distinct id of the heartbeat.
- **Per-account id**: `u_` + the first 32 hex characters of HMAC-SHA256(instance secret, account id). The
  secret is 32 random bytes generated on first start, kept in the database and never sent. The id is stable
  within one instance (so daily and monthly actives can be counted), different on every other instance, and
  cannot be turned back into the account id.

## What is sent

Every event carries these properties:

| Property                  | Example                          |
| ------------------------- | -------------------------------- |
| `instance_id`             | random UUID of the instance      |
| `app_version`             | `0.1.0`                          |
| `demo`                    | `true` on a `DEMO_MODE` instance |
| `origin`                  | `server` or `web`                |
| `$process_person_profile` | `false`                          |
| `$geoip_disable`          | `true`                           |
| `$ip`                     | `null`                           |

PostHog's library adds `$lib` (`posthog-node`), `$lib_version` and `$is_server: true`, and sends with the user agent `posthog-node/<version>`.

Buckets are `0`, `1`, `2-5`, `6-10`, `11-25`, `26-50`, `51-100`, `101-250`, `251-1000`, `1001+`.

### Daily heartbeat: `instance_heartbeat`

Sent once a day (checked hourly; the first one a minute after a new instance starts), from the instance id.

| Property                           | Type                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `db`                               | `sqlite` or `postgres`                                                                    |
| `node_major`                       | Node.js major version, e.g. `24`                                                          |
| `discord_login`                    | Discord sign-in configured                                                                |
| `eve_sso`                          | EVE SSO configured                                                                        |
| `login_method`                     | `discord` or `eve` (EVE-only mode)                                                        |
| `discord_bot`                      | an instance Discord bot is connected                                                      |
| `plugins_first_party`              | enabled plugins shipped with Darkbeacon (`discord-notify`, `sample-widget`)               |
| `plugins_third_party`              | bucket: other enabled plugins (never their ids)                                           |
| `theme_default`                    | `system`, `default`, `dark`, `contrast`, `amarr`, `large`, `pathfinder` or `custom`       |
| `themes_third_party`               | bucket: installed themes that are not first-party                                         |
| `event_retention`                  | an event log retention is set                                                             |
| `accounts`                         | number of accounts                                                                        |
| `characters`                       | number of linked EVE characters                                                           |
| `maps`                             | number of maps                                                                            |
| `accounts_dau` / `_wau` / `_mau`   | accounts seen in the last 1 / 7 / 30 days                                                 |
| `characters_dau` / `_wau` / `_mau` | characters of those accounts                                                              |
| `online_peak`                      | most tracked characters online at once since the last heartbeat (sampled every 5 minutes) |
| `systems`                          | bucket: visible systems on all maps                                                       |
| `connections`                      | bucket: connections on all maps                                                           |
| `signatures`                       | bucket: signatures on all maps                                                            |
| `webhooks`                         | bucket: enabled webhooks                                                                  |
| `discord_notify_maps`              | bucket: maps posting Discord notifications                                                |

### Feature events (server)

From committed domain events and successful API calls, as the account behind them (per-account id). Changes
made while seeding the demo map or by cleanups count as nothing; a history revert counts once as
`history_reverted`, not as the changes it writes. `source` is `manual` (web app), `auto` (auto-mapping), `api`
(API token) or `plugin`.

| Event                                | Properties                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signed_in`                          | `method`: `discord`, `eve`, `demo`, `dev`                                                                                                                                                            |
| `map_created`                        |                                                                                                                                                                                                      |
| `system_added`                       | `source`                                                                                                                                                                                             |
| `connection_added`                   | `type`: `wormhole`, `gate`, `bridge`; `source`                                                                                                                                                       |
| `connection_updated`                 | `field`: `type`, `time`, `eol`, `mass`, `size`, `bubble`, `dangerous`, `mass_saved`, `lock`, `note`, `lifetime`; `source` (one event per field)                                                      |
| `labels_changed`                     | the map's Tags were replaced                                                                                                                                                                         |
| `system_labels_changed`              | the map's Labels (WH1, WH2...) were replaced                                                                                                                                                         |
| `ping_created`                       |                                                                                                                                                                                                      |
| `access_rule_added`                  | `subject`: `discordRole`, `character`, `corporation`, `alliance`, `account`                                                                                                                          |
| `webhook_created`                    |                                                                                                                                                                                                      |
| `history_reverted`                   |                                                                                                                                                                                                      |
| `plugin_enabled` / `plugin_disabled` | `plugin`: a first-party id or `third_party`                                                                                                                                                          |
| `signatures_pasted`                  | `added`, `updated`, `removed`: buckets                                                                                                                                                               |
| `route_computed`                     | `mode`: `shortest`, `safer`, `highsec`, `outlaw`, `pilot`; `skips`, `avoids`: booleans                                                                                                               |
| `bookmark_template_changed`          | `scope`: `map` or `personal`                                                                                                                                                                         |
| `esi_picker_used`                    | `category`: `character`, `corporation`, `alliance`; `mode`: `search` or `exact`                                                                                                                      |
| `waypoint_set`                       | `mode`: `destination` or `waypoint`                                                                                                                                                                  |
| `import_completed`                   | `source`: `api`, `file` or `database`; `status`: `done`, `failed`, `cancelled`; `systems`, `connections`, `signatures`, `access_rules`: buckets of what was written (never the Wanderer host or map) |
| `jump_planned`                       | `hull`: `jump_freighter`, `black_ops`, `rorqual`, `carrier`, `command_carrier`, `dreadnought`, `lancer`, `force_auxiliary`, `supercarrier`, `titan`; `legs`: bucket (`0` = no route)                 |
| `passage_logged`                     | `source`: `tracked` or `manual`; `mode`: `cold`, `hot`, `custom`                                                                                                                                     |
| `roll_planned`                       | `result`: `ok`, `risky`, `impossible`                                                                                                                                                                |

### Web app events

| Event               | Properties                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_loaded`        | `viewport`: `phone`, `tablet`, `desktop`; `tti`: `<1s`, `1-2s`, `2-4s`, `4-8s`, `8s+`                                                                                                                    |
| `theme_used`        | `theme` (as `theme_default`); `scheme`: `light` or `dark`                                                                                                                                                |
| `page_viewed`       | `page`: `map`, `maps`, `account`, `admin`, `map_settings`, `oauth_consent`, `import`, `jump`, `characters`, `changelog`; `section`: the admin or map settings tab                                        |
| `panel_opened`      | `panel`: `system`, `signatures`, `local`, `routes`, `connections`, `history`, `plugin`                                                                                                                   |
| `context_menu_used` | `menu`: `system` or `connection`; `action`: `status`, `labels`, `tags`, `edit`, `hidden`, `locked`, `copy_name`, `remove`, `time`, `mass`, `size`, `type`, `bubble`, `dangerous`, `mass_saved`, `plugin` |
| `shortcut_used`     | `shortcut`: `fit_chain`, `center_on_me`, `legend`, `undo`, `delete_selection`, `copy_selection`, `paste_systems`                                                                                         |
| `activity_viewed`   | `section`: `activity` or `kills`; `window`: `1h`, `4h`, `12h`, `24h`, `7d` (its time window was changed)                                                                                                 |
| `feedback_rated`    | `rating`: `up` or `down`; `area`: the page, as for `page_viewed` (the thumbs in the help menu)                                                                                                           |

## Support tickets and feedback are not telemetry

The help menu's "Report a problem" and "Send feedback" carry what a person writes and are tied to the EVE
character they sign in with, so they never go through telemetry: they go to the support hub, a separate
PostHog project, only when someone sends them (see [docs/support.md](support.md)). The only help-menu
signal that is telemetry is the thumbs up or down (`feedback_rated`): an enum and the kind of page, nothing
typed.

## Delivery

- Nothing waits on the network: events are queued in memory and sent in batches (20 events or every 30 s) by
  `posthog-node`, gzip compressed.
- When PostHog cannot be reached (or answers 429/5xx) the batch stays queued and the next send waits with
  exponential backoff (5 s doubling up to an hour, with jitter). The queue holds at most 1000 events; the oldest
  are dropped beyond that. Nothing is written to disk, so a restart loses what was queued.
- At most 300 events per minute leave an instance; more are dropped and counted on the admin card.
- On shutdown the queue is flushed (for at most 5 s).

## Why

- **Opt-out, on by default**: an opt-in heartbeat from self-hosted software reaches almost nobody, and the
  numbers then say nothing about how many groups use Darkbeacon. What is collected is limited to what cannot
  identify a group, a person or a place in New Eden, and every payload can be inspected before and after it is
  sent.
- **Demo instances send, marked `demo: true`**: previews are a large share of first contacts and say which
  features people try; the flag keeps them out of real usage numbers.
- **Through the server**: browser events are forwarded by the instance, so the allow-list and the stripping are
  guaranteed in one place, ad blockers do not skew the numbers, and no third-party code runs in the app.
- **Counts as buckets** where an exact number could single out a group (systems, signatures, webhooks), exact
  only where the number is the point (accounts, characters, maps, actives).

## For the maintainers: setting up PostHog

1. In the ZanReal organization, create a project (e.g. "Darkbeacon telemetry") in the **EU** region
   (`eu.posthog.com`; events go to `https://eu.i.posthog.com`).
2. Project settings: turn on **Discard client IP data**, keep person profiles off ("Identified only" or
   never), and leave session recording, autocapture, heatmaps and surveys off (nothing uses them).
3. Copy the project API key (`phc_...`; it can only write events) into `DEFAULT_TELEMETRY_KEY` in
   `packages/modules/telemetry/src/domain/defaults.ts`. Builds made after that send; older ones stay inert.
4. Useful insights: unique `instance_id` of `instance_heartbeat` per day (instances), sum of the latest
   `accounts_mau` per instance (players), feature events broken down by their properties, `demo = false` as a
   filter everywhere.
