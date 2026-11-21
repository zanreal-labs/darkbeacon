'use client';

import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import {
  ROUTE_WATCH_DEFAULT_HOURS,
  ROUTE_WATCH_MAX_JUMPS,
  routes,
  type RouteWatchDto,
  type RouteWatchListDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import { useMe } from '../../lib/session';
import { Button, Checkbox, Input, SearchPicker, Select, type PickerOption, useToast } from '../../ui';
import { useRouteWatchActions, useWatchPosting } from './api';
import styles from './routes.module.css';

/** A system a watch can wait in, as the picker shows it. */
export interface WatchTarget {
  solarSystemId: number;
  name: string;
}

interface SystemOption extends PickerOption {
  target: WatchTarget;
}

const HOURS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: 'for 1 hour' },
  { value: '4', label: 'for 4 hours' },
  { value: '12', label: 'for 12 hours' },
  { value: '24', label: 'for 24 hours' },
  { value: '48', label: 'for 2 days' },
  { value: '72', label: 'for 3 days' },
];

/** Wormhole space (C1-C6, Thera, shattered, Drifter): no watch waits there. */
const isWormholeClass = (c: number | null) => c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));

/** "in 23 h", "in 40 min": how long a watch has left. */
function left(expiresAt: number, now: number): string {
  const minutes = Math.max(1, Math.round((expiresAt - now) / 60_000));
  return minutes >= 90 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
}

/**
 * The way-home watches as one quiet line of chips: where from, the limit, and the way while one
 * is open ("Amarr ≤10 HS · open via Irnin, 9"). × removes one; a map admin also sees others'.
 */
export function WatchChips({
  mapId,
  list,
  myAccountId,
}: {
  mapId: string;
  list: RouteWatchListDto;
  myAccountId: string | null;
}) {
  const toast = useToast();
  const { remove } = useRouteWatchActions(mapId, toast);
  // Rendered again whenever the list is read (every minute at most), close enough for hours left.
  const [now] = useState(() => Date.now());
  if (list.watches.length === 0) return null;
  return (
    <ul className={styles.watches} aria-label="Way-home watches">
      {list.watches.map((watch) => {
        const mine = watch.accountId === myAccountId;
        const route = watch.route;
        return (
          <li
            key={watch.id}
            className={styles.watch}
            data-open={route ? true : undefined}
            title={watchTitle(watch, mine, now)}
          >
            <Bell aria-hidden className={styles.watchIcon} />
            <span className={styles.watchText}>
              {watch.target.name} ≤{watch.maxJumps}
              {watch.mode === 'highsec' ? ' HS' : ''}
              {route ? ` · open via ${route.mouth.name}, ${route.jumps}` : ''}
              {mine ? '' : ` · ${watch.ownerName}`}
            </span>
            <button
              type="button"
              className={styles.watchRemove}
              aria-label={`Stop watching the way home from ${watch.target.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(watch)}
            >
              <X aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function watchTitle(watch: RouteWatchDto, mine: boolean, now: number): string {
  const who = mine ? 'You are' : `${watch.ownerName} is`;
  const how = watch.mode === 'highsec' ? 'through high-sec and wormholes' : 'any way';
  const state = watch.route
    ? `Open: ${watch.route.jumps} jumps, ${watch.route.gates} gates to ${watch.route.mouth.name}, then ${watch.route.wormholeJumps} wormhole jumps.`
    : 'No way home within the limit yet.';
  return `${who} waiting for a way home from ${watch.target.name} in at most ${watch.maxJumps} jumps, ${how}. ${state} Ends in ${left(watch.expiresAt, now)}.`;
}

/**
 * "Notify me when a way home opens…": the system the pilot waits in, how many jumps the whole
 * trip may take, high-sec only, for how long. Says up front what would keep the ping from
 * arriving: no Home on the map, no Discord channel for the map, no Discord on the account.
 */
export function WatchForm({
  mapId,
  initial,
  home,
  onDone,
}: {
  mapId: string;
  initial: WatchTarget | null;
  home: RouteWatchListDto['home'] | undefined;
  onDone(): void;
}) {
  const toast = useToast();
  const me = useMe();
  const posting = useWatchPosting(mapId);
  const { create } = useRouteWatchActions(mapId, toast);
  const [target, setTarget] = useState<SystemOption | null>(initial ? option(initial) : null);
  const [jumps, setJumps] = useState('10');
  const [highsec, setHighsec] = useState(true);
  const [hours, setHours] = useState(String(ROUTE_WATCH_DEFAULT_HOURS));
  const maxJumps = Number(jumps);
  const valid =
    target !== null && Number.isInteger(maxJumps) && maxJumps >= 1 && maxJumps <= ROUTE_WATCH_MAX_JUMPS;

  const warnings: string[] = [];
  if (home === null) warnings.push('The map has no Home yet: mark one, or no way home can be found.');
  if (posting.data === false)
    warnings.push(
      'This map posts nothing about watches to Discord: a map admin sets that up in Notifications.',
    );
  if (me.data && !me.data.account.discordId)
    warnings.push('Your account has no Discord linked, so the message cannot mention you.');

  const submit = () => {
    if (!valid) return;
    create.mutate(
      {
        solarSystemId: target.target.solarSystemId,
        name: target.target.name,
        maxJumps,
        mode: highsec ? 'highsec' : 'shortest',
        hours: Number(hours),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      className={styles.watchForm}
      aria-label="Notify me when a way home opens"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SearchPicker<SystemOption>
        aria-label="Waiting in"
        placeholder="Waiting in… (system name)"
        minLength={2}
        value={target}
        cacheKey={['watch-search']}
        empty="No known-space system by that name"
        search={async (text) => {
          const found = await api<UniverseSystemDto[]>(
            `${routes.universe.searchSystems.path}?${new URLSearchParams({ q: text, limit: '8' })}`,
          );
          return {
            options: found
              .filter((s) => !isWormholeClass(s.whClass))
              .map((s) => ({ ...option({ solarSystemId: s.id, name: s.name }), detail: s.regionName })),
          };
        }}
        onChange={setTarget}
      />
      <div className={styles.watchFields}>
        <label className={styles.watchJumps}>
          <span>At most</span>
          <Input
            size="sm"
            type="number"
            inputMode="numeric"
            min={1}
            max={ROUTE_WATCH_MAX_JUMPS}
            value={jumps}
            aria-label="Most jumps, the whole trip home"
            onChange={(e) => setJumps(e.target.value)}
          />
          <span>jumps home</span>
        </label>
        <Checkbox checked={highsec} onCheckedChange={(on) => setHighsec(on === true)} label="High-sec only" />
        <Select size="sm" aria-label="How long" value={hours} options={HOURS} onValueChange={setHours} />
      </div>
      {warnings.map((w) => (
        <p key={w} className={styles.hint}>
          {w}
        </p>
      ))}
      <div className={styles.watchActions}>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          icon={<Bell />}
          disabled={!valid}
          loading={create.isPending}
        >
          Notify me
        </Button>
      </div>
    </form>
  );
}

function option(target: WatchTarget): SystemOption {
  return { key: String(target.solarSystemId), label: target.name, target };
}
