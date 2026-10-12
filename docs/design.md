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
