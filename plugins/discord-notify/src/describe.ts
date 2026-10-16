// What each kind of notification says. Pure functions over event data, the map and static
// universe data, so they are tested without Discord.
import type {
  ConnectionDto,
  DiscordNotifyKind,
  MapDto,
  MapSystemDto,
  PingDto,
  UniverseSystemDto,
  WayHomeDto,
} from '@darkbeacon/plugin-sdk';

/**
 * Embed colours: the map's own state colours, as the built-in dark theme draws them (most people
 * run Discord dark). A test keeps them equal to `@darkbeacon/theme-sdk`.
 */
export const COLORS = {
  /** color-accent */
  connection: 0x38c6d6,
  /** security-high: a way out to known space */
  exit: 0x00ef47,
  /** edge-time-eol */
  eol: 0xb25ee0,
  /** edge-mass-critical */
  critical: 0xff4040,
  /** status-hostile */
  danger: 0x940604,
  /** status-occupied */
  kill: 0xc99a3a,
  /** status-warning */
  ping: 0xc44604,
  /** status-friendly */
  arrival: 0x2c66c4,
} as const;

export interface Embed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/** One message-to-be: a kind (for the toggles), whether it may mention, and its embed. */
export interface Note {
  kind: DiscordNotifyKind;
  embed: Embed;
}

/** What describing a map's events needs to know about the map. */
export interface MapView {
  map: Pick<MapDto, 'id' | 'slug' | 'name'>;
  systems: ReadonlyMap<number, MapSystemDto>;
  universe(id: number): UniverseSystemDto | null;
  publicUrl: string;
}

const SHIP_SIZE: Record<ConnectionDto['shipSize'], string> = {
  small: 'Frigates only',
  medium: 'Up to battlecruisers',
  large: 'Up to battleships',
  xlarge: 'Up to freighters',
  capital: 'Capitals',
};

/** C1-C6, HS, LS, NS, Thera, C13, Drifter, Pochven. */
export function classLabel(whClass: number | null | undefined): string | null {
  if (whClass == null) return null;
  if (whClass >= 1 && whClass <= 6) return `C${whClass}`;
  const named: Record<number, string> = { 7: 'HS', 8: 'LS', 9: 'NS', 12: 'Thera', 13: 'C13', 25: 'Pochven' };
  if (named[whClass]) return named[whClass];
  if (whClass >= 14 && whClass <= 18) return 'Drifter';
  return null;
}

/** High-, low- and null-sec: the exits a wormhole chain is about. */
export function isKnownSpace(whClass: number | null | undefined): boolean {
  return whClass === 7 || whClass === 8 || whClass === 9;
}

export function mapLink(view: MapView, systemId?: number): string {
  const base = `${view.publicUrl.replace(/\/+$/, '')}/m/${encodeURIComponent(view.map.slug)}`;
  return systemId === undefined ? base : `${base}?system=${systemId}`;
}

export const zkillSystem = (systemId: number) => `https://zkillboard.com/system/${systemId}/`;
export const zkillKill = (killId: number) => `https://zkillboard.com/kill/${killId}/`;

/** "J123456 (C3)", "Amamake (LS)", with the map's own name for it when there is one. */
export function systemLabel(view: MapView, id: number): string {
  const u = view.universe(id);
  const placed = view.systems.get(id);
  const name = u?.name ?? `System ${id}`;
  const cls = classLabel(u?.whClass);
  const alias = placed?.customName ?? placed?.temporaryName;
  return `${name}${alias && alias !== name ? ` «${alias}»` : ''}${cls ? ` (${cls})` : ''}`;
}

function footer(view: MapView): { text: string } {
  return { text: view.map.name };
}

const when = (at: number) => new Date(at).toISOString();

/** A new connection; louder when it opens a way out to known space. */
export function connectionAdded(view: MapView, c: ConnectionDto, at: number): Note {
  const [a, b] = [view.universe(c.source), view.universe(c.target)];
  const exitSide =
    isKnownSpace(b?.whClass) && !isKnownSpace(a?.whClass)
      ? c.target
      : isKnownSpace(a?.whClass) && !isKnownSpace(b?.whClass)
        ? c.source
        : null;
  const exit = exitSide !== null && c.type === 'wormhole';
  return {
    kind: 'connections',
    embed: {
      title: exit
        ? `New exit to ${systemLabel(view, exitSide)}`
        : `New connection: ${systemLabel(view, c.source)} ↔ ${systemLabel(view, c.target)}`,
      description: exit
        ? `${systemLabel(view, exitSide === c.source ? c.target : c.source)} now connects to known space.`
        : undefined,
      url: mapLink(view, exitSide ?? c.target),
      color: exit ? COLORS.exit : COLORS.connection,
      fields: [
        {
          name: 'Type',
          value: c.type === 'wormhole' ? 'Wormhole' : c.type === 'gate' ? 'Stargate' : 'Jump bridge',
          inline: true,
        },
        { name: 'Ships', value: SHIP_SIZE[c.shipSize], inline: true },
      ],
      footer: footer(view),
      timestamp: when(at),
    },
  };
}

/** What changed for the worse on a connection: end of life, critical mass, danger, bubbles. */
export function connectionChanged(
  view: MapView,
  before: Pick<ConnectionDto, 'timeStatus' | 'massStatus' | 'dangerous' | 'bubbled'> | null,
  c: ConnectionDto,
  at: number,
): Note[] {
  const notes: Note[] = [];
  const pair = `${systemLabel(view, c.source)} ↔ ${systemLabel(view, c.target)}`;
  const base = { url: mapLink(view, c.target), footer: footer(view), timestamp: when(at) };
  if (c.timeStatus === 'eol' && before?.timeStatus !== 'eol') {
    notes.push({
      kind: 'eol',
      embed: {
        ...base,
        title: `End of life: ${pair}`,
        description: 'Less than 4 hours left.',
        color: COLORS.eol,
      },
    });
  }
  if (c.massStatus === 'critical' && before?.massStatus !== 'critical') {
    notes.push({
      kind: 'eol',
      embed: {
        ...base,
        title: `Critical mass: ${pair}`,
        description: 'Less than 10 % of its mass left.',
        color: COLORS.critical,
      },
    });
  }
  if (c.dangerous && !before?.dangerous) {
    notes.push({ kind: 'danger', embed: { ...base, title: `Dangerous: ${pair}`, color: COLORS.danger } });
  }
  if (c.bubbled !== 'none' && (before?.bubbled ?? 'none') === 'none') {
    const at =
      c.bubbled === 'both'
        ? 'both sides'
        : `the ${systemLabel(view, c.bubbled === 'source' ? c.source : c.target)} side`;
    notes.push({
      kind: 'danger',
      embed: { ...base, title: `Bubbled: ${pair}`, description: `Bubble on ${at}.`, color: COLORS.danger },
    });
  }
  return notes;
}

/** A system marked hostile. */
export function systemMarkedHostile(view: MapView, s: MapSystemDto, at: number): Note {
  return {
    kind: 'danger',
    embed: {
      title: `Hostile: ${systemLabel(view, s.solarSystemId)}`,
      description: s.description ? s.description.slice(0, 300) : undefined,
      url: mapLink(view, s.solarSystemId),
      color: COLORS.danger,
      fields: [{ name: 'Kills', value: `[zKillboard](${zkillSystem(s.solarSystemId)})`, inline: true }],
      footer: footer(view),
      timestamp: when(at),
    },
  };
}

export function rallyPing(view: MapView, ping: PingDto, at: number): Note {
  return {
    kind: 'pings',
    embed: {
      title: `Ping in ${systemLabel(view, ping.solarSystemId)}`,
      description: ping.message.slice(0, 1000) || undefined,
      url: mapLink(view, ping.solarSystemId),
      color: COLORS.ping,
      footer: footer(view),
      timestamp: when(at),
    },
  };
}

export function arrival(view: MapView, character: string, systemId: number, at: number): Note {
  return {
    kind: 'arrivals',
    embed: {
      title: `${character} entered the chain`,
      description: `In ${systemLabel(view, systemId)}.`,
      url: mapLink(view, systemId),
      color: COLORS.arrival,
      footer: footer(view),
      timestamp: when(at),
    },
  };
}

export interface KillSummary {
  killId: number;
  systemId: number;
  victim: string | null;
  ship: string | null;
  value: number | null;
  attackers: number | null;
  time: number;
}

export function isk(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B ISK`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M ISK`;
  return `${Math.round(value / 1e3)}K ISK`;
}

export function killInChain(view: MapView, kill: KillSummary): Note {
  const what = [kill.ship, kill.victim ? `of ${kill.victim}` : null].filter(Boolean).join(' ');
  return {
    kind: 'kills',
    embed: {
      title: `Kill in ${systemLabel(view, kill.systemId)}`,
      description:
        [what || 'A ship', 'died', kill.value ? `(${isk(kill.value)})` : null].filter(Boolean).join(' ') +
        '.',
      url: zkillKill(kill.killId),
      color: COLORS.kill,
      fields: [
        ...(kill.attackers ? [{ name: 'Attackers', value: String(kill.attackers), inline: true }] : []),
        {
          name: 'On the map',
          value: `[Open ${view.map.name}](${mapLink(view, kill.systemId)})`,
          inline: true,
        },
        { name: 'System', value: `[zKillboard](${zkillSystem(kill.systemId)})`, inline: true },
      ],
      footer: footer(view),
      timestamp: when(kill.time),
    },
  };
}

/** At most this many hubs in the way home. */
export const WAY_HOME_ROUTES = 5;

const SPACE: Record<WayHomeDto['routes'][number]['space'], string> = {
  high: ' (high-sec only)',
  low: ' (low/null only)',
  mixed: '',
};

/**
 * The way home: from each hub of the map, how many jumps and through which mouth the trip
 * leaves known space into the chain, nearest first ("Jita: 7J via Tama (low/null only)").
 */
export function wayHomeNote(view: MapView, wayHome: WayHomeDto, at: number): Note | null {
  if (!wayHome.home) return null;
  const home = wayHome.home.solarSystemId;
  const routes = wayHome.routes.slice(0, WAY_HOME_ROUTES);
  const lines = routes.map(
    (r) =>
      `**${r.hub.name}**: ${r.jumps}J via [${r.mouth.name}](${mapLink(view, r.mouth.solarSystemId)})${SPACE[r.space]}${r.viaEveScout ? ' · through Thera/Turnur' : ''}`,
  );
  return {
    kind: 'wayHome',
    embed: {
      title: `Way home to ${systemLabel(view, home)}`,
      description:
        routes.length > 0 ? lines.join('\n') : 'No hub of the map has a way into the chain right now.',
      url: mapLink(view, home),
      color: COLORS.exit,
      footer: footer(view),
      timestamp: when(at),
    },
  };
}

export function testNote(view: MapView, at: number): Note {
  return {
    kind: 'connections',
    embed: {
      title: 'Darkbeacon is connected',
      description: `Notifications of ${view.map.name} will show up here.`,
      url: mapLink(view),
      color: COLORS.connection,
      footer: footer(view),
      timestamp: when(at),
    },
  };
}
