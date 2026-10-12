'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Anchor, ExternalLink, MoreHorizontal, Radio } from 'lucide-react';
import { buildPath, routes, type CharacterDto, type CharacterPresenceDto } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { characterLinks, shipIconUrl, useEveEntities, useShipTypes } from '../../lib/characters';
import { usePreference } from '../../lib/preferences';
import {
  CharacterAvatar,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
  useToast,
} from '../../ui';
import { seedCharacters } from '../mapState';
import type { MapStore } from '../useMapStore';
import styles from './sidebar.module.css';

/**
 * Tracked characters of the map over REST, merged into the stream's: new ones only reach the
 * stream with the next snapshot, so this polls while the sidebar is open.
 */
export function usePresence(mapId: string, store: Pick<MapStore, 'seed'>) {
  const presence = useQuery({
    queryKey: ['presence', mapId],
    queryFn: () => api<CharacterPresenceDto[]>(buildPath(routes.tracking.characters.path, { mapId })),
    refetchInterval: 30_000,
  });
  const { seed } = store;
  useEffect(() => {
    if (presence.data) seed((s) => seedCharacters(s, presence.data));
  }, [presence.data, seed]);
  return presence;
}

/** Wanderer's Local widget options, kept with my preferences. */
export interface LocalOptions {
  /** One line per pilot, smaller portraits. */
  compact: boolean;
  showOffline: boolean;
  /** The ship's own name instead of its type. */
  showShipName: boolean;
}

export const LOCAL_DEFAULTS: LocalOptions = { compact: false, showOffline: true, showShipName: false };

const isLocalOptions = (v: unknown): v is LocalOptions =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function useLocalOptions() {
  return usePreference<LocalOptions>('local', LOCAL_DEFAULTS, isLocalOptions);
}

/**
 * The Local section's one menu: which of my characters this map tracks (members), and how the
 * list shows pilots.
 */
export function LocalMenu({
  mapId,
  myCharacters,
  tracked,
  canTrack,
  onChanged,
}: {
  mapId: string;
  myCharacters: CharacterDto[];
  tracked: ReadonlySet<number>;
  canTrack: boolean;
  onChanged(): Promise<unknown>;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<number | null>(null);
  const [options, setOptions] = useLocalOptions();
  const setTracking = async (characterId: number, on: boolean) => {
    setPending(characterId);
    try {
      await api(buildPath(routes.tracking.set.path, { mapId }), {
        method: 'PUT',
        json: { characterId, tracked: on },
      });
      await onChanged();
    } catch (e) {
      toast({
        title: 'Tracking did not change',
        description: e instanceof ApiError ? e.message : 'Network error',
        tone: 'danger',
      });
    } finally {
      setPending(null);
    }
  };
  const keepOpen = (e: Event) => e.preventDefault();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label="Local: tracking and options" tooltipSide="left" icon={<Radio />} />
      </MenuTrigger>
      <MenuContent>
        {canTrack && myCharacters.length > 0 && (
          <>
            <MenuLabel>Track on this map</MenuLabel>
            {myCharacters.map((c) => (
              <MenuCheckboxItem
                key={c.id}
                checked={tracked.has(c.id)}
                disabled={(!c.tokenValid && !tracked.has(c.id)) || pending === c.id}
                onCheckedChange={(on) => void setTracking(c.id, on === true)}
                onSelect={keepOpen}
              >
                {c.tokenValid ? c.name : `${c.name} (sign-in expired)`}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
          </>
        )}
        <MenuLabel>Show</MenuLabel>
        <MenuCheckboxItem
          checked={options.showOffline}
          onCheckedChange={(on) => setOptions({ showOffline: on === true })}
          onSelect={keepOpen}
        >
          Offline pilots
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={options.showShipName}
          onCheckedChange={(on) => setOptions({ showShipName: on === true })}
          onSelect={keepOpen}
        >
          Ship names instead of types
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={options.compact}
          onCheckedChange={(on) => setOptions({ compact: on === true })}
          onSelect={keepOpen}
        >
          Compact list
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

const openOutside = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

/** Corporation and alliance tickers, `[CORP] <ALLY>`. */
function tickers(corp: string | null | undefined, alliance: string | null | undefined): string | null {
  const parts = [corp && `[${corp}]`, alliance && `<${alliance}>`].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Tracked characters in the selected system: portrait, name with corporation and alliance, ship
 * type (or name) and docked; mine first and highlighted, then online, then offline (hidden on
 * request). Each row links to zKillboard and EveWho.
 */
export function LocalSection({
  here,
  mine,
  expired = new Set(),
}: {
  here: CharacterPresenceDto[];
  mine: ReadonlySet<number>;
  /** My characters whose sign-in expired: their place here is stale. */
  expired?: ReadonlySet<number>;
}) {
  const [options] = useLocalOptions();
  const groups = useEveEntities(here.flatMap((c) => [c.corporationId, c.allianceId]));
  const ships = useShipTypes(here.map((c) => c.shipTypeId));
  const shown = options.showOffline ? here : here.filter((c) => c.online || mine.has(c.characterId));
  const hidden = here.length - shown.length;
  if (here.length === 0) return <p className={styles.empty}>Nobody tracked is in this system.</p>;
  const sorted = [...shown].sort(
    (a, b) =>
      Number(mine.has(b.characterId)) - Number(mine.has(a.characterId)) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name),
  );
  return (
    <>
      <ul className={styles.pilots} data-compact={options.compact || undefined}>
        {sorted.map((c) => {
          const corp = c.corporationId ? groups.byId.get(c.corporationId) : undefined;
          const alliance = c.allianceId ? groups.byId.get(c.allianceId) : undefined;
          const type = c.shipTypeId !== null ? ships.get(c.shipTypeId)?.name : undefined;
          const ship = options.showShipName ? (c.shipName ?? type) : (type ?? c.shipName);
          const stale = expired.has(c.characterId);
          const links = characterLinks(c.characterId);
          const affiliation = tickers(corp?.ticker, alliance?.ticker);
          const affiliationTitle = [corp?.name, alliance?.name].filter(Boolean).join(' · ');
          return (
            <li
              key={c.characterId}
              className={styles.pilot}
              data-mine={mine.has(c.characterId) || undefined}
              data-online={c.online}
            >
              <CharacterAvatar id={c.characterId} name={c.name} size={options.compact ? 20 : 24} />
              <span className={styles.pilotText}>
                <span className={styles.pilotName}>
                  {c.name}
                  {mine.has(c.characterId) && <span className="sr-only"> (you)</span>}
                </span>
                {affiliation && !options.compact && (
                  <span className={styles.pilotGroup} title={affiliationTitle || undefined}>
                    {affiliation}
                  </span>
                )}
              </span>
              <span className={styles.ship}>
                {stale ? (
                  <span className="error">Sign-in expired</span>
                ) : (
                  <>
                    {c.online && c.docked && (
                      <Tooltip content="Docked">
                        <Anchor className={styles.docked} aria-label="Docked" tabIndex={0} />
                      </Tooltip>
                    )}
                    {c.shipTypeId !== null && c.online && (
                      <img src={shipIconUrl(c.shipTypeId)} alt="" width={16} height={16} />
                    )}
                    <span title={ship && type && ship !== type ? type : undefined}>
                      {c.online ? (ship ?? 'Ship unknown') : 'Offline'}
                    </span>
                  </>
                )}
              </span>
              <Menu>
                <MenuTrigger asChild>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className={styles.pilotMore}
                    label={`Links for ${c.name}`}
                    tooltip={false}
                    icon={<MoreHorizontal />}
                  />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<ExternalLink />} onSelect={() => openOutside(links.zkill)}>
                    zKillboard
                  </MenuItem>
                  <MenuItem icon={<ExternalLink />} onSelect={() => openOutside(links.evewho)}>
                    EveWho
                  </MenuItem>
                </MenuContent>
              </Menu>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className={styles.pilotsHidden}>
          {hidden} offline {hidden === 1 ? 'pilot' : 'pilots'} hidden
        </p>
      )}
    </>
  );
}
