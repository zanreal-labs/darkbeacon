'use client';

import { useEffect, useState } from 'react';
import type { CharacterDto, MapPingDto } from '@darkbeacon/shared';
import { ChevronDown, MapPinPlus, Megaphone, Navigation, UserRound, Users, X } from 'lucide-react';
import { relativeTime } from '../../lib/time';
import {
  Avatar,
  Button,
  characterPortraitUrl,
  ConfirmDialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../../ui';
import type { Corner } from '../canvas/prefs';
import { RouteStrip } from '../routes/RouteStrip';
import { sendWaypoint, useRoute, useRoutePreferences, type WaypointMode } from '../routes/api';
import { waypointPilots } from '../menus/routes';
import type { ToastInput } from '../../ui';
import styles from './rally.module.css';

interface Props {
  mapId: string;
  ping: MapPingDto;
  /** The pinged system's name on this map. */
  name: string;
  /** Where the way there starts: the selected system, else the viewer's own location. */
  from: { solarSystemId: number; name: string } | null;
  corner: Corner;
  canCancel: boolean;
  characters: readonly CharacterDto[] | undefined;
  /** The in-game route can be set (known space; EVE routes nowhere else). */
  routable: boolean;
  notify(toast: ToastInput): void;
  onShow(): void;
  onSelectStep(solarSystemId: number): void;
  onCancel(): void;
}

const WAYPOINTS: Array<{ mode: WaypointMode; label: string }> = [
  { mode: 'waypoint', label: 'Add waypoint' },
  { mode: 'front', label: 'Add waypoint first' },
];

/** "All characters", then each character: picking one sends the route at once. */
function PilotItems({
  pilots,
  send,
}: {
  pilots: readonly CharacterDto[];
  send(who: CharacterDto | 'all'): void;
}) {
  return (
    <>
      <MenuItem icon={<Users />} onSelect={() => send('all')}>
        All characters
      </MenuItem>
      <MenuSeparator />
      {pilots.map((c) => (
        <MenuItem key={c.id} icon={<UserRound />} onSelect={() => send(c)}>
          {c.name}
        </MenuItem>
      ))}
    </>
  );
}

/**
 * The map's rally ping, in the corner the viewer chose: where, the message, who called it and
 * when, the way there from the selected system (or the viewer's own) and what to do about it. It
 * folds into a small pill; a new rally opens it again.
 */
export function RallyCard({
  mapId,
  ping,
  name,
  from,
  corner,
  canCancel,
  characters,
  routable,
  notify,
  onShow,
  onSelectStep,
  onCancel,
}: Props) {
  const [open, setOpen] = useState(true);
  const [confirm, setConfirm] = useState(false);
  // A new rally opens the card again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
  }, [ping.id]);
  const { preferences } = useRoutePreferences();
  const route = useRoute(mapId, from?.solarSystemId ?? null, ping.solarSystemId, preferences, open);
  const pilots = routable ? waypointPilots(characters) : [];
  const target = { solarSystemId: ping.solarSystemId, name };
  const who = ping.characterName ?? ping.createdByName ?? 'Someone';

  if (!open)
    return (
      <button
        type="button"
        className={styles.pill}
        data-corner={corner}
        onClick={() => setOpen(true)}
        aria-label={`Rally in ${name}: show`}
      >
        <Megaphone aria-hidden />
        <span>Rally</span>
        <span className={styles.pillName}>{name}</span>
      </button>
    );

  const here = from?.solarSystemId === ping.solarSystemId;
  return (
    <section className={styles.card} data-corner={corner} aria-label="Rally" role="region">
      <header className={styles.head}>
        <Megaphone className={styles.icon} aria-hidden />
        <div className={styles.title}>
          <span className={styles.kind}>Rally</span>
          <button type="button" className={styles.system} onClick={onShow}>
            {name}
          </button>
        </div>
        <IconButton size="sm" label="Fold the rally card" icon={<X />} onClick={() => setOpen(false)} />
      </header>
      {ping.message && <p className={styles.message}>{ping.message}</p>}
      <p className={styles.meta}>
        {ping.characterId && <Avatar src={characterPortraitUrl(ping.characterId, 32)} name={who} size={16} />}
        <span>{who}</span>
        <span aria-hidden>·</span>
        <time
          dateTime={new Date(ping.createdAt).toISOString()}
          title={new Date(ping.createdAt).toLocaleString()}
        >
          {relativeTime(ping.createdAt)}
        </time>
      </p>
      {from && !here && (
        <div className={styles.route}>
          <span className={styles.routeText}>
            From {from.name}:{' '}
            {route.isPending ? '…' : route.data?.jumps == null ? 'no way there' : `${route.data.jumps} jumps`}
          </span>
          {route.data && route.data.steps.length > 1 && (
            <RouteStrip steps={route.data.steps} onSelect={(step) => onSelectStep(step.solarSystemId)} />
          )}
        </div>
      )}
      {here && <p className={styles.routeText}>{from?.name} is the rally point.</p>}
      <footer className={styles.actions}>
        {pilots.length === 1 && (
          <Button
            size="sm"
            icon={<Navigation />}
            title={`For ${pilots[0]!.name}`}
            onClick={() => void sendWaypoint(pilots[0]!, target, 'destination', notify)}
          >
            Set destination
          </Button>
        )}
        {pilots.length > 1 && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Navigation />} trailingIcon={<ChevronDown />}>
                Set destination
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              <PilotItems
                pilots={pilots}
                send={(who) => void sendWaypoint(who, target, 'destination', notify)}
              />
            </MenuContent>
          </Menu>
        )}
        {pilots.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton size="sm" label="Add as a waypoint" icon={<MapPinPlus />} tooltip={false} />
            </MenuTrigger>
            <MenuContent align="start">
              {WAYPOINTS.map((way) =>
                pilots.length === 1 ? (
                  <MenuItem
                    key={way.mode}
                    onSelect={() => void sendWaypoint(pilots[0]!, target, way.mode, notify)}
                  >
                    {way.label}
                  </MenuItem>
                ) : (
                  <MenuSub key={way.mode}>
                    <MenuSubTrigger>{way.label}</MenuSubTrigger>
                    <MenuSubContent>
                      <PilotItems
                        pilots={pilots}
                        send={(who) => void sendWaypoint(who, target, way.mode, notify)}
                      />
                    </MenuSubContent>
                  </MenuSub>
                ),
              )}
            </MenuContent>
          </Menu>
        )}
        <Button size="sm" variant="ghost" onClick={onShow}>
          Show
        </Button>
        {canCancel && (
          <Button size="sm" variant="ghost" className={styles.cancel} onClick={() => setConfirm(true)}>
            Cancel rally
          </Button>
        )}
      </footer>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel the rally?"
        description={`Everyone on the map stops seeing the rally in ${name}.`}
        confirmLabel="Cancel rally"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={onCancel}
      />
    </section>
  );
}
