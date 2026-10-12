'use client';

import { useState } from 'react';
import { BarChart3, Search } from 'lucide-react';
import type { CharacterPresenceDto, UniverseSystemDto } from '@darkbeacon/shared';
import { useEveEntities } from '../../lib/characters';
import { usePreference } from '../../lib/preferences';
import { CharacterAvatar, Input, Switch } from '../../ui';
import styles from './characters.module.css';

/** "On the map" options, kept with my preferences. */
export interface OnTheMapPrefs {
  showOffline: boolean;
}
const isPrefs = (v: unknown): v is OnTheMapPrefs =>
  typeof v === 'object' && v !== null && typeof (v as OnTheMapPrefs).showOffline === 'boolean';

/** Lower-case words a row is found by: name, corporation and alliance names and tickers, system. */
function haystack(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Everyone tracked on the map (Wanderer's "On the map"): where they are and in what, searchable
 * by name, corporation, alliance, ticker or system, offline ones hidden unless asked for. A click
 * centres the map on the character's system.
 */
export function OnTheMapPanel({
  characters,
  universe,
  shipName,
  onCenter,
  onShowActivity,
}: {
  characters: ReadonlyMap<number, CharacterPresenceDto>;
  universe: ReadonlyMap<number, UniverseSystemDto>;
  shipName(typeId: number): string | undefined;
  onCenter(solarSystemId: number): void;
  onShowActivity(): void;
}) {
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = usePreference<OnTheMapPrefs>('on-the-map', { showOffline: false }, isPrefs);
  const all = [...characters.values()];
  const groups = useEveEntities(all.flatMap((c) => [c.corporationId, c.allianceId]));
  const ticker = (id: number | null | undefined) => (id ? groups.byId.get(id) : undefined);
  const q = query.trim().toLowerCase();
  const rows = all
    .filter((c) => prefs.showOffline || c.online)
    .map((c) => {
      const corp = ticker(c.corporationId);
      const alliance = ticker(c.allianceId);
      const system = c.solarSystemId !== null ? universe.get(c.solarSystemId)?.name : undefined;
      return { c, corp, alliance, system };
    })
    .filter(
      ({ c, corp, alliance, system }) =>
        !q ||
        haystack(c.name, corp?.name, corp?.ticker, alliance?.name, alliance?.ticker, system).includes(q),
    )
    .sort((a, b) => Number(b.c.online) - Number(a.c.online) || a.c.name.localeCompare(b.c.name));
  const offline = all.filter((c) => !c.online).length;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <strong>On the map</strong>
        <span className="muted">
          {all.length - offline} online{offline > 0 ? ` · ${offline} offline` : ''}
        </span>
      </div>
      <div className={styles.panelTools}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, corp, alliance, ticker, system"
          aria-label="Search characters on the map"
          icon={<Search />}
        />
        <Switch
          checked={prefs.showOffline}
          onCheckedChange={(showOffline) => setPrefs({ showOffline })}
          label="Show offline"
        />
      </div>
      {rows.length === 0 ? (
        <p className={styles.panelEmpty}>
          {all.length === 0
            ? 'Nobody is tracked on this map yet.'
            : q
              ? 'Nobody matches.'
              : 'Everyone is offline.'}
        </p>
      ) : (
        <ul className={styles.onMapList}>
          {rows.map(({ c, corp, alliance, system }) => (
            <li key={c.characterId}>
              <button
                type="button"
                className={styles.onMapRow}
                data-online={c.online || undefined}
                disabled={c.solarSystemId === null}
                onClick={() => c.solarSystemId !== null && onCenter(c.solarSystemId)}
              >
                <CharacterAvatar id={c.characterId} name={c.name} size={24} />
                <span className={styles.onMapMain}>
                  <span className={styles.onMapName}>
                    {c.name}
                    {(corp?.ticker || alliance?.ticker) && (
                      <span className={styles.ticker}>
                        {[corp?.ticker && `[${corp.ticker}]`, alliance?.ticker && `<${alliance.ticker}>`]
                          .filter(Boolean)
                          .join(' ')}
                      </span>
                    )}
                  </span>
                  <span className={styles.onMapWhere}>
                    {c.online
                      ? [
                          system ?? 'Unknown system',
                          c.shipTypeId !== null ? shipName(c.shipTypeId) : null,
                          c.docked ? 'docked' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : `Offline${system ? ` · last seen in ${system}` : ''}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.panelFooter}>
        <button type="button" onClick={onShowActivity}>
          <BarChart3 aria-hidden />
          Character activity
        </button>
      </div>
    </div>
  );
}
