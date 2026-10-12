# Design

How Darkbeacon looks and why. The product is used during combat on a second screen: every screen
must be readable at a glance, need few clicks and show no raw ids or empty placeholder sections.
Colours come from theme tokens (`--dbk-*`, see `packages/theme-sdk`), so every rule here holds in
the light, dark and high-contrast themes.

## The map

### Opening view

- The map opens at one fixed zoom, `DEFAULT_ZOOM` = 0.9 (`apps/web/src/map/mapType.ts`). Canvas type
  sizes are chosen with it: system names 15 px (13.5 px on screen), pills, chips and bookmark tags
  13 px (11.7 px), connection badges 12.5 px (11.25 px). A test keeps the products at or above
  13 / 11.5 / 11 px.
- It centres on, in order: the viewer's last view of this map (kept on the server per account), the
  viewer's own character, the home system, the system changed last. It never fits the whole chain
  on open, because chains can be huge.
- `F` fits the whole chain (never below zoom 0.5), `C` centres on me, `L` shows the legend. The
  same actions are buttons in the bottom-left toolbar.

### System node

- Every node has the same size. The width is what the widest system name of the game needs in the
  node's name font next to the widest class pill: the build picks the longest names from the
  universe dataset (`node-sizers.ts`, via `next.config.ts`) and the node lays them out invisibly, so
  the width follows whatever font a theme sets. Longer custom names are cut with an ellipsis (full
  name in the tooltip). Three rows of fixed height, so the chain lines up on a grid.
- The background tint is the system status and nothing else: unknown (neutral), home, friendly,
  empty, occupied, warning, hostile, target; one fixed tint each (`node-status-*` tokens), all with
  WCAG AA contrast for the node's text in every built-in theme (tested). The status is also in the
  tooltip and the legend.
- Other colour only where it means something: the security pill (filled with the security colour,
  black or white text, whichever passes AA), the wormhole class pill, static chips (coloured by
  where they lead), label chips (the label's colour). Selection is an accent outline.
- Content, top to bottom: class or security pill and name; statics and an automatic `EXIT` chip
  (`EXIT H/L/N`: a wormhole system with a static into known space, or a known-space system the
  chain reaches through a wormhole); up to two labels and `+N`. Above the node: the bookmark tag on
  the left, "You are here" with my portrait (or the pilot count) on the right. Under an exit: the
  nearest trade hub (`Jita 12j`) when the routing API answers it. A bubble badge sits on the corner
  of a system with a bubbled connection end.
- Everything else (region, effect, tag, notes, lock) is in the tooltip.

### Connections

A healthy wormhole is a calm plain line; only exceptions shout, each on its own channel so they
combine and survive colour blindness (`edgeStyle.ts`):

| Property | Channel        | States                                                                                          |
| -------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Mass     | colour         | fresh neutral, reduced amber, critical red and a little thicker                                 |
| Time     | pattern        | normal solid, EOL dashed with an `EOL ~2h10m` badge                                             |
| Size     | thickness      | frigate thin with `F`, medium, large (default), XL thick                                        |
| Danger   | halo           | a red halo along the whole line and a warning badge                                             |
| Bubble   | shape          | a 30 px half see-through circle with a thick outline on the bubbled end, above every other line |
| Type     | icon / pattern | gates solid neutral with a gate icon, Ansiblex bridges dotted lime                              |

At most two badges on a line, most urgent first (danger, EOL, critical, frigate, reduced, medium,
XL); the hover card lists everything. The hit area is 22 px wide; hover and selection light the line
from end to end. The legend draws its samples with the same functions, and a test checks that every
state looks different.

### Bookmark labels

The small mono tag above a system: by default the signature of the wormhole that leads into it from
its parent (`ABC-123`); a click copies it. Templates mix text with `{sig} {sig3} {chainIndex}
{destClass} {type} {size} {mass} {eol} {tempName}`; managers set the map default, everyone may pick
their own (Map settings → Bookmark labels, or the bookmark button on the map). A temporary name wins
unless the template places `{tempName}` itself. The chain is walked from the home system;
`{chainIndex}` is the depth and the order among siblings (`1a`, `1b`, `2a`).
