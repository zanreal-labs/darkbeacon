import { createElement } from 'react';
import type { CharacterDto, HubsDto, StationDto } from '@darkbeacon/shared';
import { Building2, MapPin, MapPinPlus, Navigation, Star, UserRound, Users } from 'lucide-react';
import type { MenuItem } from '../../components/ContextMenu';
import type { ToastInput } from '../../ui';
import { sendWaypoint, type WaypointMode } from '../routes/api';

/*
 * Route items of the map's and the routes panel's context menus: the in-game destination (first,
 * last or instead of the route; one character or all), the stations of a system, and whether
 * the system is one of the map's or the viewer's hubs.
 */

const icon = (component: typeof Navigation) => createElement(component);

type Notify = (toast: ToastInput) => void;

export interface WaypointTarget {
  solarSystemId: number;
  name: string;
  stationId?: number;
  /** Wormhole space: EVE's autopilot routes over stargates only, so there is no destination. */
  wormhole?: boolean;
}

const MODES: ReadonlyArray<{ mode: WaypointMode; label: string; icon: typeof Navigation }> = [
  { mode: 'destination', label: 'Set destination', icon: Navigation },
  { mode: 'waypoint', label: 'Add waypoint', icon: MapPinPlus },
  { mode: 'front', label: 'Add waypoint first', icon: MapPin },
];

function modeItems(character: CharacterDto | 'all', target: WaypointTarget, notify?: Notify): MenuItem[] {
  return MODES.map(({ mode, label, icon: Icon }) => ({
    kind: 'action',
    label,
    icon: icon(Icon),
    onSelect: () => void sendWaypoint(character, target, mode, notify),
  }));
}

/** The characters whose EVE grant lets them have a route set. */
export function waypointPilots(characters: readonly CharacterDto[] | undefined): CharacterDto[] {
  return (characters ?? []).filter((c) => c.canSetWaypoints && c.tokenValid);
}

/**
 * "Set destination" with its three ways for one character, or for all of them and each one
 * apart when the viewer has several.
 */
export function waypointMenu(
  characters: readonly CharacterDto[] | undefined,
  target: WaypointTarget,
  notify?: Notify,
): MenuItem[] {
  const pilots = waypointPilots(characters);
  if (pilots.length === 0 || target.wormhole) return [];
  return [
    {
      kind: 'submenu',
      label: 'Set destination',
      icon: icon(Navigation),
      items:
        pilots.length === 1
          ? modeItems(pilots[0]!, target, notify)
          : [
              {
                kind: 'submenu',
                label: 'All characters',
                icon: icon(Users),
                items: modeItems('all', target, notify),
              },
              { kind: 'separator' },
              ...pilots.map((c): MenuItem => ({
                kind: 'submenu',
                label: c.name,
                icon: icon(UserRound),
                items: modeItems(c, target, notify),
              })),
            ],
    },
  ];
}

/** The stations of a system, each a destination of its own (the main one of a trade hub first). */
export function stationsMenu(
  characters: readonly CharacterDto[] | undefined,
  system: { solarSystemId: number; name: string },
  stations: readonly StationDto[] | undefined,
  notify?: Notify,
): MenuItem[] {
  if (!stations || stations.length === 0) return [];
  const pilots = waypointPilots(characters);
  const sorted = [...stations].sort(byOrbit);
  return [
    {
      kind: 'submenu',
      label: 'Stations',
      icon: icon(Building2),
      hint: String(stations.length),
      items:
        pilots.length === 0
          ? [{ kind: 'label', label: 'No character may have a route set' }]
          : sorted.map((s) => {
              const target = { solarSystemId: system.solarSystemId, stationId: s.id, name: s.name };
              return {
                kind: 'submenu',
                label: s.main ? `★ ${s.name}` : s.name,
                items:
                  pilots.length === 1
                    ? modeItems(pilots[0]!, target, notify)
                    : [
                        ...modeItems('all', target, notify),
                        { kind: 'separator' },
                        ...pilots.map((c): MenuItem => ({
                          kind: 'submenu',
                          label: c.name,
                          icon: icon(UserRound),
                          items: modeItems(c, target, notify),
                        })),
                      ],
              } satisfies MenuItem;
            }),
    },
  ];
}

/** Planet, then moon, then name: "Jita IV - Moon 4" before "Jita V - Moon 1". */
function byOrbit(a: StationDto, b: StationDto): number {
  const orbit = (s: StationDto) => {
    const match = / ([IVXLC]+)(?: \([^)]*\))? - (?:Moon (\d+) - )?/.exec(s.name);
    return match ? [fromRoman(match[1]!), Number(match[2] ?? 0)] : [999, 0];
  };
  const [pa, ma] = orbit(a);
  const [pb, mb] = orbit(b);
  return Number(b.main) - Number(a.main) || pa! - pb! || ma! - mb! || a.name.localeCompare(b.name);
}

function fromRoman(text: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = values[text[i]!]!;
    const next = values[text[i + 1] ?? ''] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

export interface HubMenuContext {
  /** The map's and the viewer's hubs, as `GET /api/maps/:mapId/hubs` answers. */
  hubs: HubsDto | undefined;
  /** Members may change the map's hubs. */
  canEdit: boolean;
  toggle(list: 'map' | 'personal', hub: { solarSystemId: number; name: string }, on: boolean): void;
}

/** "Map hub" and "My hub" toggles for a system. */
export function hubMenu(
  ctx: HubMenuContext | undefined,
  system: { solarSystemId: number; name: string },
): MenuItem[] {
  if (!ctx?.hubs) return [];
  const has = (list: 'map' | 'personal') =>
    ctx.hubs![list].some((h) => h.solarSystemId === system.solarSystemId);
  const items: MenuItem[] = [];
  if (ctx.canEdit) {
    items.push({
      kind: 'check',
      label: 'Map hub',
      title: 'Everyone on the map sees the route to it',
      icon: icon(Star),
      checked: has('map'),
      onSelect: () => ctx.toggle('map', system, !has('map')),
    });
  }
  items.push({
    kind: 'check',
    label: 'My hub',
    title: 'Only you see the route to it, on every map',
    icon: icon(UserRound),
    checked: has('personal'),
    onSelect: () => ctx.toggle('personal', system, !has('personal')),
  });
  return items;
}
