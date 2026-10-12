# Design

How Darkbeacon should look and behave. `docs/SPEC.md` is the engineering contract and `docs/decisions.md`
the log of choices; this file is about the people using it.

## Who and when

The map is used during combat, on a second screen, next to the game. Someone glances at it between
locking targets and calling jumps. Everything follows from that:

- **Glanceable.** The answer to "can we still get out, and where to?" must be readable in a second: big
  names, classes as players write them ("C3", "HS", "Thera"), mass and time as words and colours that
  mean the same everywhere (critical, EOL, reduced), jumps as a number.
- **Low friction.** One click or one key for what people do under pressure (mark EOL or critical, set a
  destination, paste signatures). No confirmation dialogs for things that can be undone.
- **No raw ids.** People see system names, signature ids as the game shows them (`ABC-123`) and character
  names, never database or EVE ids. Pickers search; they never ask for a number.
- **Nothing half-built.** A section either works or is not shown. No placeholders, no "coming soon".
- **English copy**, short and plain.
- Works at 1440x900 and 390x844, in light, dark and high contrast.

## Server data built for glancing

The API does the thinking so panels only show it:

- `GET /api/maps/:mapId/connections/intel` gives each connection already resolved: the wormhole type (K162
  resolved from the other side, or guessed from the one static that leads there, marked as a guess), where
  each side leads, which hull classes fit, mass and time left as estimates with an urgency
  (`critical`, `warning`, `ok`), most urgent first. A panel lists it top to bottom.
- Exits (`GET /api/maps/:mapId/exits`, `routes.exits_changed` on the stream, `exits` in map snapshots) say
  where the chain touches known space and how many jumps the nearest hub is; statics to known space that are
  not open yet are listed separately, so "D845 HS still unscanned" is visible.
- Routes (`GET /api/maps/:mapId/route`) come step by step with names, classes and how each jump is made
  (gate, wormhole, bridge), for the modes people ask for: shortest, safer, high-sec only, outlaw (no
  high-sec) and "for this pilot" (no high-sec where faction police shoot them). Outlaw and pilot modes swap
  trade hubs they cannot enter for staging systems next to them.
- Setting the in-game destination is one call for a character whose EVE grant allows it
  (`canSetWaypoints` on the character).

Estimates are upper bounds (a hole may have spawned before anyone saw it) and should be shown as "at most".

## System

- Tokens only (`--dbk-*` from theme-sdk); no colour is written in a component except user data
  (label colours). Themes change tokens, never features.
- Components from `apps/web/src/ui`; screens compose cards (header: title, one-sentence description,
  at most one action), rows (leading icon or portrait, a sentence, a quiet meta line, a trailing time or
  action) and the shell.
- Inter with tabular figures for numbers next to text; JetBrains Mono only for things people copy.
- Quiet by default: muted meta text, one accent colour for actions and selection, status colours only
  for status.

## Audit

- An entry is a sentence: **who** did what, then the changes as chips (`Field before → after`; a new
  value alone when there was none), then a meta line: character portrait and name, how it came in
  (Web, Auto-mapping, a plugin), country and browser. The time sits on the right on wide screens and
  leads the meta line on phones.
- Entries group by day; repeated sign-ins of one person fold into one row ("4 times"); access re-checks
  only show under "Roles and access".
- Secrets never appear: webhook addresses keep only their host, secret settings show as "hidden" with a
  fingerprint that changes when they do.
- Filters are two choices (person, kind) and export is one menu; retention is a single choice and the
  integrity check a single button with a one-line verdict.

## Presence

- Everyone on the map has one colour (`--dbk-presence-0` … `-7`) for their cursor, drag preview,
  selection outline and editing marker, the same on every tab and map.
- "Who is here" shows one entry per person (portrait, character name, a tab count when above one), not
  per tab.
- Cursors are opt-out on both sides (account page: share my cursor, show other people's cursors); who
  is here and editing markers always show, because they prevent two people changing the same thing.
