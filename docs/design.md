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
