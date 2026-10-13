'use client';

import { useCallback, useState } from 'react';
import { ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import type { KillmailDto, UniverseSystemDto } from '@darkbeacon/shared';
import { ago, formatIsk, groupLabel, groupOf, images, useMapKills, zkill } from '../../lib/intel';
import { track } from '../../lib/telemetry';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui';
import { readStored, writeStored } from './storage';
import styles from './intel.module.css';

export const KILL_HOURS = [4, 12, 24] as const;
export type KillHours = (typeof KILL_HOURS)[number];

/** The viewer's choices for the Kills section, per map, kept in this browser. */
export interface KillsSettings {
  /** The selected system only, or every visible system of the map. */
  scope: 'system' | 'all';
  /** Only systems in wormhole space. */
  wormholes: boolean;
  hours: KillHours;
  /** Systems left out of "all systems". */
  excluded: number[];
}

export const DEFAULT_KILLS_SETTINGS: KillsSettings = {
  scope: 'system',
  wormholes: false,
  hours: 4,
  excluded: [],
};

const isSettings = (v: unknown): v is KillsSettings =>
  typeof v === 'object' &&
  v !== null &&
  ['system', 'all'].includes((v as KillsSettings).scope) &&
  typeof (v as KillsSettings).wormholes === 'boolean' &&
  (KILL_HOURS as readonly number[]).includes((v as KillsSettings).hours) &&
  Array.isArray((v as KillsSettings).excluded);

export function useKillsSettings(mapId: string) {
  const key = `dbk-kills-settings:${mapId}`;
  const [settings, setState] = useState<KillsSettings>(
    () => (typeof window === 'undefined' ? null : readStored(key, isSettings)) ?? DEFAULT_KILLS_SETTINGS,
  );
  const update = useCallback(
    (patch: Partial<KillsSettings>) =>
      setState((old) => {
        const next = { ...old, ...patch };
        writeStored(key, next);
        return next;
      }),
    [key],
  );
  return [settings, update] as const;
}

/** The section's action: what the list covers. */
export function KillsSettingsMenu({
  settings,
  update,
  solarSystemId,
  systemName,
}: {
  settings: KillsSettings;
  update(patch: Partial<KillsSettings>): void;
  solarSystemId: number;
  systemName: string;
}) {
  const excluded = settings.excluded.includes(solarSystemId);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="sm" label="Kill list settings" tooltipSide="left" icon={<SlidersHorizontal />} />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Show kills of</MenuLabel>
        <MenuRadioGroup
          value={settings.scope}
          onValueChange={(v) => update({ scope: v as KillsSettings['scope'] })}
        >
          <MenuRadioItem value="system" onSelect={(e) => e.preventDefault()}>
            This system
          </MenuRadioItem>
          <MenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
            Every system on the map
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuCheckboxItem
          checked={settings.wormholes}
          onCheckedChange={(on) => update({ wormholes: on === true })}
          onSelect={(e) => e.preventDefault()}
        >
          Only wormhole systems
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuLabel>Time</MenuLabel>
        <MenuRadioGroup
          value={String(settings.hours)}
          onValueChange={(v) => {
            const hours = Number(v) as KillHours;
            update({ hours });
            track('activity_viewed', { section: 'kills', window: `${hours}h` as '4h' | '12h' | '24h' });
          }}
        >
          {KILL_HOURS.map((h) => (
            <MenuRadioItem key={h} value={String(h)} onSelect={(e) => e.preventDefault()}>
              Last {h} hours
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={excluded}
          onCheckedChange={(on) =>
            update({
              excluded: on
                ? [...settings.excluded, solarSystemId]
                : settings.excluded.filter((id) => id !== solarSystemId),
            })
          }
          onSelect={(e) => e.preventDefault()}
        >
          Leave {systemName} out of every system
        </MenuCheckboxItem>
        {settings.excluded.length > 0 && (
          <MenuItem onSelect={() => update({ excluded: [] })}>
            Show the {settings.excluded.length} left-out system{settings.excluded.length === 1 ? '' : 's'}{' '}
            again
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

function KillRow({ kill, systemName }: { kill: KillmailDto; systemName: string | null }) {
  const victimGroup = groupOf(kill.victim);
  const top = kill.attackers[0];
  const attacker = top ? (top.alliance ?? top.corporation) : null;
  const ship = kill.victim.ship;
  return (
    <li className={styles.kill}>
      {ship ? (
        <img
          className={styles.killIcon}
          src={images.type(ship.id)}
          alt=""
          width={24}
          height={24}
          loading="lazy"
        />
      ) : (
        <span className={styles.killIcon} />
      )}
      <span className={styles.killMain}>
        <span className={styles.killTitle}>
          {systemName && <span className={styles.killSystem}>{systemName} · </span>}
          {ship?.name ?? 'A ship'}
          {victimGroup && <span className={styles.ticker}> {groupLabel(victimGroup)}</span>}
        </span>
        <span className={styles.muted}>
          {kill.npc
            ? 'by NPCs'
            : kill.solo
              ? `solo by ${groupLabel(attacker, 'a pilot')}`
              : `by ${groupLabel(attacker, 'pilots')}${kill.attackerCount > 1 ? ` +${kill.attackerCount - 1}` : ''}`}
        </span>
      </span>
      <span className={styles.killSide}>
        <span className={styles.killValue}>{formatIsk(kill.value)}</span>
        <span className={styles.muted}>{ago(kill.time)}</span>
      </span>
      <a
        className={styles.killLink}
        href={zkill.kill(kill.id)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Killmail ${ship?.name ?? ''} on zKillboard`}
        title="zKillboard"
      >
        <ArrowUpRight aria-hidden />
      </a>
    </li>
  );
}

/**
 * The killmails the section lists, with the viewer's choices: also read by the sidebar for the
 * count in the folded title bar (one query either way).
 */
export function useKillList(mapId: string, solarSystemId: number, settings: KillsSettings) {
  const all = settings.scope === 'all';
  const kills = useMapKills(mapId, {
    hours: settings.hours,
    ...(all ? {} : { systems: [solarSystemId] }),
    wormholes: settings.wormholes,
    limit: 50,
  });
  const list = (kills.data?.kills ?? []).filter((k) => !all || !settings.excluded.includes(k.solarSystemId));
  return { kills, list };
}

/**
 * Killmails of the selected system, or of every visible system on the map (minus those left
 * out), newest first, with the time and space the viewer picked.
 */
export function KillsSection({
  mapId,
  solarSystemId,
  settings,
  universe,
}: {
  mapId: string;
  solarSystemId: number;
  settings: KillsSettings;
  universe: ReadonlyMap<number, UniverseSystemDto>;
}) {
  const all = settings.scope === 'all';
  const { kills, list } = useKillList(mapId, solarSystemId, settings);
  if (kills.isLoading) return <p className={styles.empty}>Loading kills…</p>;
  if (list.length === 0)
    return (
      <p className={styles.empty}>
        No kills {all ? 'on the map' : 'here'} in the last {settings.hours} hours
        {settings.wormholes ? ' in wormhole space' : ''}.
      </p>
    );
  return (
    <ul className={styles.kills}>
      {list.map((k) => (
        <KillRow
          key={k.id}
          kill={k}
          systemName={all ? (universe.get(k.solarSystemId)?.name ?? null) : null}
        />
      ))}
    </ul>
  );
}
