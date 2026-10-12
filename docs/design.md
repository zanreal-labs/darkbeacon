# Design

How Darkbeacon looks and reads. `docs/SPEC.md` is the engineering contract and `docs/decisions.md`
the log of choices; this file is the product's design brief. Add a section when a screen gets rules
of its own.

## Who it is for

A pilot mid-fight with the map on a second screen. They look for a second, not a minute. Every screen:

- reads at a glance: the important thing is the biggest, the rest is quieter; no walls of text;
- needs as few clicks as possible, and never a form for something that can be a toggle or a choice;
- shows names, never raw ids (systems, characters, maps, people; ids only where a person must copy
  one, such as a Discord server id they paste themselves);
- has no placeholder sections: a card exists because it does something today;
- works at 1440x900 and 390x844, in light, dark and high contrast; copy is English.

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
