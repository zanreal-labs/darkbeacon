/**
 * What changed, for people using Darkbeacon (the update prompt links here). Newest first; one
 * entry per release, each item a sentence about something people can see or do.
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date of the release. */
  date: string;
  title: string;
  groups: Array<{ name: string; items: string[] }>;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-10-12',
    title: 'Everything a Wanderer chain needs',
    groups: [
      {
        name: 'Characters and tracking',
        items: [
          'A characters page: where each character is, in what ship, what its EVE sign-in allows, and which maps track it.',
          'Track characters from the map’s top bar or straight from an empty map; your characters sit next to it with their online state.',
          'Follow a character: the map selects and centres its system whenever it jumps.',
          'Pick a main character per map.',
          'On the map: everyone tracked on the map, where they are and in what, searchable by name, corporation, alliance or system.',
          'Character activity: jumps and the systems, connections and signatures each character added.',
          'Local shows corporations and alliances, ship types, docked pilots and links to zKillboard and EveWho, with options for offline pilots, ship names and a compact list.',
          'Holes between two known-space systems (high-sec to low-sec, Turnur, K162s in k-space) are mapped even when only wormhole space is tracked; Jita is left out.',
          'One notice on every page names the characters that need linking again and what they lack.',
          'Wallet balances and assets are asked for only when you choose to allow them.',
          'Tracking waits while Tranquility is down; the top bar shows its status and your connection’s round trip.',
        ],
      },
      {
        name: 'Your preferences',
        items: [
          'My preferences on the account page: export, import and reset everything you set, which follows you between browsers.',
          'Hide and reorder the sections of the system sidebar.',
        ],
      },
      {
        name: 'Map',
        items: [
          'Kills, sovereignty, standings, NPC kills and who flies where, on the nodes and in the sidebar.',
          'A routes panel with hubs, jump bridges, Thera and the way home.',
          'Passages, jump mass and a rolling planner for every connection.',
          'Wanderer-style Labels (WH1, WH2…) and coloured Tags.',
          'A capital jump planner on a map of all known space.',
        ],
      },
      {
        name: 'Running an instance',
        items: [
          'Import maps from Wanderer, export and import maps as files, and a Wanderer-compatible API for existing bots.',
          'Access rules where a corporation or alliance block wins, an admin view of every map and character, and invites.',
          'Built-in backups with restore, OpenTelemetry, and anonymous usage reports you can switch off.',
        ],
      },
    ],
  },
];
