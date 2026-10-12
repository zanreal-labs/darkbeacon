# Design

How Darkbeacon should look and behave. `docs/SPEC.md` is the engineering contract and `docs/decisions.md`
the log of choices; this file is about the people using it. The UI parts live in `apps/web/src/ui` (one
barrel, `../ui`) and all of them are on the component gallery at `/dev/components` (development and demo
instances), light and dark side by side.

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

## Principles

- **Glanceable.** The answer first, in words: "Posting", "Failing", "Opens first for you". Status
  is a badge with a word and a colour, never a colour alone.
- **Low friction.** One obvious next step per screen. Defaults that work; settings that apply as
  soon as they are flipped when nothing can go wrong (switches), a Save button when several fields
  belong together.
- **No raw ids.** People pick characters, corporations, alliances, accounts, Discord servers, roles
  and channels by name (search pickers and lists). Ids never show, not even as a fallback: an
  unknown subject reads "A corporation ESI does not know". Map addresses (`/m/home-chain`) are the
  only identifiers people type.
- **No placeholder sections.** A card is there because it does something now. If a feature needs
  setup first (a bot, a plugin), the card says what to do and links there.
- **English, plain.** Sentences, not labels with colons. Buttons say what they do ("Connect bot",
  "Sign out everywhere…"); an ellipsis means a confirmation follows.

## Layout

- Pages are a column (`Page`, 760 px for one-topic pages, 880 px for settings) with a
  `PageHeader` (title, one line of description, at most one action) and cards stacked 16 px apart
  (`Stack`).
- Settings with several topics use tabs under the header; the open tab is in `?tab=`.
- Settings of a map are a dialog over the map (`DialogSheet`): sections as vertical tabs on the left,
  the open one scrolling on the right, its form's buttons in a footer that stays in view; the open
  section is in `?settings=`.
- Phones: 16 px side gutter, everything in one column, no sideways scrolling.

## Cards

One anatomy everywhere:

1. **Header** (`CardHeader`): title, one line of description, optional actions on the right (one
   button, a switch or a menu).
2. **Body** (`CardBody`): 16 px padding on every side; `flush` for edge-to-edge lists (`Rows`).
3. **Footer** (`CardFooter`), only for actions: right-aligned, under a 1 px divider, on the
   card's own surface. There is no second surface colour in a card (no darker footer band, no
   tinted boxes inside; inner boxes use a border only).

A card holds one form at most. Its footer carries that form's buttons; status text goes on the
left of the footer (`margin-right: auto`), muted.

## Buttons

- **Primary** (`variant="primary"`): the one main action of a card, at most one per card and one
  per dialog. The page header's action may be primary when the page has no form ("New map").
- **Secondary** (default): everything else that does something.
- **Ghost**: Cancel and Discard, and toolbar buttons.
- **Danger** (`variant="danger"`): destructive actions (delete the map, sign out everywhere). A
  danger button never acts at once: it opens a `ConfirmDialog`, whose confirm button is danger
  too, and its label ends with an ellipsis when it opens one ("Sign out everywhere…").
- **Never a bare red text button** (no red ghost buttons). Remove buttons in lists are neutral icon
  buttons (`Trash2`) that open a `ConfirmDialog` with a danger confirm.
- Heights: 32 px (`md`, default), 26 px (`sm`) inside rows and card headers, 40 px (`lg`) only on
  the sign-in page. Icons are lucide, 16 px (14 px in `sm`).
- Icons: the same icon for the same action everywhere: `Plus` add, `Trash2` remove, `Settings`
  settings, `Star` default map, `Send` test, `LogOut` sign out, `ArrowUpRight` leaves the page.

## Lists and rows

`Rows` and `Row` inside a `flush` card body: leading picture or icon (32 or 36 px), a title line
with badges, a muted meta line, actions on the right. Pictures: Discord avatars and EVE portraits
are round, corporation and alliance logos and Discord server icons rounded squares.

## Forms

- `Field` wraps every control: label above, one line of hint below, the error replacing the hint.
- Pickers: `SearchPicker` for names (debounced search, arrows and Enter, the choice shown as a chip
  with a clear button); `Select` for short known lists (roles, servers, channels); `ChoiceGroup`
  for two to four options that need a sentence each.
- Destructive confirmations say what is lost and for whom, in one sentence.

## Feedback

- Toasts for things that happened (saved, posted, failed), with the server's message on failure.
- `Callout` for states that last (not set up, failing, demo mode): tone and a title that is the
  answer ("Posting failed 5 min ago").
- `EmptyState` says what is missing and the next step, with that step's button.
- Loading: skeletons the size of what is coming; spinners only inside buttons and pickers.

## Colour

Only theme tokens (`--dbk-*`). Map states keep their meaning everywhere, Discord embeds included:
accent for connections and selection, `security-high` green for ways out to known space,
`edge-time-eol` purple for end of life, `edge-mass-critical` and `status-hostile` red for critical
and danger, `status-warning` amber for pings and stars, `status-friendly` green for arrivals.

## The map

### Opening view

- The map opens at one fixed zoom, `DEFAULT_ZOOM` = 0.9 (`apps/web/src/map/mapType.ts`). Canvas type
  sizes are chosen with it: system names 15 px (13.5 px on screen), pills and annotations 13 px
  (11.7 px), the size letter on a connection 12.5 px (11.25 px). A test keeps the products at or above
  13 / 11.5 / 11 px.
- It centres on, in order: the viewer's last view of this map (kept on the server per account), the
  viewer's own character, the home system, the system changed last. It never fits the whole chain
  on open, because chains can be huge.
- `F` fits the whole chain (never below zoom 0.5), `C` centres on me, `L` shows the legend. The
  same actions are buttons in the bottom-left toolbar.

### System node

- Every node has the same size. The width is what the widest system name of the game needs in the
  node's name font next to the widest designation pill: the build picks the longest names from the
  universe dataset (`node-sizers.ts`, via `next.config.ts`) and the node lays them out invisibly, so
  the width follows whatever font a theme sets. Longer custom names are cut with an ellipsis (full
  name in the tooltip).
- Surface: the neutral node background, never tinted. A 3 px border carries the status: grey by
  default, home blue, friendly green, warning yellow, hostile and dangerous red, target purple. No
  side stripe. Selection is an accent outline outside the border.
- Row 1: a solid, fixed-width designation pill first, the class (`C1`-`C6`, `Thera`, `C13`, Drifter
  and Pochven names) or the security (`0.8`, `0.4`, `-0.4`, `-1.0`) in its EVE colour as the pill's
  background with dark bold monospace text; then the name (15 px semibold); the pilot count on the
  right, in the accent colour when I am there.
- Row 2: the statics as plain text, the hole type in the normal text colour (white in dark themes)
  and monospace, the destination (`HS`, `LS`, `NS`, `C1`-`C6`) in its colour right after it:
  `D845 HS`. No chips, no borders.
- Nothing else on the node: region, effect, tag, notes and lock are in the tooltip and the side panel.
- Above the node, left-aligned with its left edge: the map labels (a small coloured square and the
  label's name, `■ Staging`), then the bookmark code (`ABC-123`, a click copies it).
- Below an exit system, left-aligned: the nearest hub and its jumps (`Jita 4j`), followed by a small
  square in the colour of the space the whole route runs through (high-sec green, low-sec orange,
  null-sec red) only when it runs through one kind of space; a mixed route shows no square. The
  numbers come from the routing API (`exits` in the map snapshot and `routes.exits_changed`).

### Connections

Every connection is the same thick two-layer line (8 px at 100 %), so state reads from colour alone
(`edgeStyle.ts`):

| Property | Channel                  | States                                                                    |
| -------- | ------------------------ | ------------------------------------------------------------------------- |
| Time     | outer layer colour       | normal neutral, EOL purple, under an hour left (critical time) pink       |
| Mass     | inner core colour        | fresh neutral, reduced amber, critical red                                |
| Danger   | red halo beyond the line | dangerous                                                                 |
| Size     | a letter at the midpoint | `S`, `M`, `XL`, `C` (capital); large shows nothing. Never the line width. |
| Bubble   | a circle on the line     | just outside the bubbled system (centre radius + 6 px past its border)    |
| Type     | pattern                  | Ansiblex bridges dotted lime; gates plain neutral                         |

The size letter is the only text ever drawn on a connection. Everything else (type, time left, mass
left, saved mass, who changed it) is in the hover card and the Connections panel. The legend draws
its samples with the same functions as the edge, and a test checks that every state looks different.

### Bookmark labels

The small mono tag above a system: by default the signature of the wormhole that leads into it from
its parent (`ABC-123`); a click copies it. Templates mix text with `{sig} {sig3} {chainIndex}
{destClass} {type} {size} {mass} {eol} {tempName}`; managers set the map default, everyone may pick
their own (Map settings → Bookmark labels, or the bookmark button on the map). A temporary name wins
unless the template places `{tempName}` itself. The chain is walked from the home system;
`{chainIndex}` is the depth and the order among siblings (`1a`, `1b`, `2a`).

### Around the map

- Map settings open as a modal dialog from an icon in the left rail; the map stays live behind it.
  There is no settings button on the canvas, and no settings screen replaces the map.
- The selected system has one sidebar, docked to the right edge under the top bar (380 px, resized
  by dragging its left edge, width remembered) and hidden while nothing is selected; the close
  button clears the selection, a toggle in the top bar hides it and keeps the selection. No tabs:
  it shows everything at once, stacked: the system's header (always in view), System, Signatures,
  Local and plugin widgets. Each section has a compact header (title, count, at most one action)
  and folds; folded sections stay folded. Phones get the same content in a bottom sheet with a
  handle (peek shows the header, then half and full).
- The header carries what is needed at a glance: the designation pill (the node's), the name and
  custom name, region › constellation, the kind of space ("Class 3 wormhole", "High-sec 0.82"),
  the effect (its summary on hover) and the statics as plain text (`D845 HS`), the tag and the
  lock. The System section edits status, labels, names, tag and notes in place (saved on Enter or
  leaving the field) and links out to zKillboard, Dotlan and Anoikis; Set destination is its
  action. Kills and jumps show there once an intel source provides them.
- Signatures are a table (id, group, type or name with where a wormhole leads, age), edited in
  place. Ctrl+V anywhere outside a text field pastes probe scanner results into the selected
  system; a toast says "3 new / 1 updated".
- Local lists the tracked characters in the system (portrait, name, ship), yours first and
  highlighted; tracking your characters is the section's action.
- Context menus are short lists (at most about eight items, one line each with an icon and a key
  hint) with submenus for choices (`Status ▸`, `Labels ▸`, `Mass ▸`, `Time ▸`...), never settings
  panels with chips or switches.
- Other people on the map are arrow cursors with a name tag in their colour; the top bar says
  `Live · 3 on this map`. No avatar circles for presence.

## The jump planner

The one place Darkbeacon goes further than Wanderer: `/jump` (the rail's orbit icon, under the map)
is a map of all known space for planning a capital's jump route, a jump freighter's or a titan's,
from A to B.

- The map is the in-game star map seen from above: every system a dot in its security colour (the
  game's palette, as on the pills), Pochven and Zarzakh in the special-space colour, stargates as
  faint lines, region names when zoomed out and system names when zoomed in. Drag to pan, scroll or
  pinch to zoom; it stays at 60 frames a second on a laptop.
- A system under the pointer shows a card: name, security, region, how far it is from the start
  and whether a jump can land there ("High-sec: no cynos"). A click pins the card with its actions:
  Start here, Destination, Avoid. Right-click does the same.
- The controls are a panel docked on the left (a bottom sheet on phones, folded at first): hull and
  ship, start and destination (search, or from the map), the three skills, route options (finish
  over stargates, stop at NPC stations, outlaw, keep fatigue under, fatigue now, avoid, Ansiblex
  bridges, bridged mass), then the route.
- The answer comes first: "3 jumps 20.19 ly", then fuel in the ship's isotope, fatigue at the end
  and the waiting; then the legs, each with the system's security pill, light years, fuel, wait and
  fatigue. Hovering a leg shows the range around its start on the map; a click flies there.
- The range (light years with the chosen Jump Drive Calibration) is a dashed disk around the start;
  until there is a route, systems a jump cannot reach from it are dimmed.
- Copy route gives plain lines for fleet chat (`1. Jump 9.95 ly to Ahbazon (0.4, Genesis),
industrial cyno, 31,524 fuel`); Set waypoints puts the stops into the game for a character whose
  EVE grant allows it.
- The address holds the start, destination and ship by name (`/jump?from=…&to=…&ship=Ark`), so a
  route can be linked. `/` searches, Esc clears.

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
