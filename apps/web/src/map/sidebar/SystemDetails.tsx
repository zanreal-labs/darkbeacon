'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Lock, LockOpen, Map as MapIcon, Navigation, Orbit, Skull, Telescope, X } from 'lucide-react';
import {
  buildPath,
  routes,
  SystemStatus,
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  wormholeDestination,
  CUSTOM_LABEL_MAX,
  type LabelDto,
  type SystemLabelDto,
  type MapSystemDto,
  type UniverseSystemDto,
  type WormholeEffect,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { useMe } from '../../lib/session';
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  Select,
  Tooltip,
  useToast,
} from '../../ui';
import { classPill, shownSecurity, STATUS_LABEL } from '../nodeFacts';
import type { MapStore } from '../useMapStore';
import { destinationToken } from '../WormholeFacts';
import { EffectTable } from './EffectTable';
import { InlineText } from './InlineText';
import { NotesField } from './NotesField';
import styles from './sidebar.module.css';

/**
 * Kills and jumps of the last hour and day, when an intel source provides them. Nothing in the
 * core does yet; the details show the row only with data.
 */
export interface SystemActivity {
  kills1h?: number;
  kills24h?: number;
  jumps1h?: number;
}

type Store = Pick<MapStore, 'updateSystem'>;

/** Wormhole space as Anoikis lists it: classes 1-6, Thera, the shattered C13s and drifter holes. */
export function isWormholeSpace(info: Pick<UniverseSystemDto, 'whClass'> | undefined): boolean {
  const c = info?.whClass ?? null;
  return c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));
}

/** "Class 3 wormhole", "High-sec 0.95": what kind of space, in words. */
export function spaceText(info: UniverseSystemDto): string {
  const c = info.whClass;
  if (c !== null && c >= 1 && c <= 6) return `Class ${c} wormhole`;
  if (c === 12) return 'Thera';
  if (c === 13) return 'Shattered wormhole';
  if (c !== null && c >= 14 && c <= 18) return 'Drifter wormhole';
  if (c === 25) return 'Pochven';
  const shown = shownSecurity(info.security);
  const band = shown >= 0.5 ? 'High-sec' : shown > 0 ? 'Low-sec' : 'Null-sec';
  return `${band} ${info.security.toFixed(2)}`;
}

/** The node's designation pill: class or security, in its EVE colour. */
export function DesignationPill({ info }: { info: UniverseSystemDto | undefined }) {
  const pill = classPill(info);
  const style =
    pill.kind === 'security'
      ? { background: pill.background }
      : pill.kind === 'class'
        ? { background: cssVar(pill.token) }
        : undefined;
  return (
    <span className={styles.pill} data-kind={pill.kind} style={style}>
      {pill.label}
    </span>
  );
}

/** Statics as the node writes them: the hole type, then where it leads in that place's colour. */
export function StaticsLine({ statics }: { statics: readonly string[] }) {
  if (statics.length === 0) return null;
  return (
    <ul className={styles.statics} aria-label="Statics">
      {statics.map((type) => {
        const to = wormholeDestination(type);
        const where = to ? WORMHOLE_DESTINATION_LABEL[to] : null;
        return (
          <li key={type} title={where ? `Static ${type} to ${where}` : `Static ${type}`}>
            <span className={styles.staticCode}>{type}</span>
            {where && <span style={{ color: cssVar(destinationToken(to)) }}>{where}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Effect({ effect, whClass }: { effect: WormholeEffect; whClass: number | null }) {
  const { name, summary } = WORMHOLE_EFFECTS[effect];
  return (
    <Tooltip content={<EffectTable effect={effect} whClass={whClass} />} side="bottom" align="start">
      <span className={styles.effect} tabIndex={0} aria-label={`${name}: ${summary}`}>
        <Orbit aria-hidden />
        {name}
      </span>
    </Tooltip>
  );
}

/**
 * The top of the sidebar, always in view: pill, name, where it is, effect and statics, the lock
 * and the close button (which clears the selection).
 */
export function SystemIdentity({
  system,
  info,
  can,
  store,
  onClose,
  dragHandle,
  holder,
}: {
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  can: MapPermissions;
  store: Store;
  onClose(): void;
  /** The phone sheet's handle, above the name. */
  dragHandle?: ReactNode;
  /** Who holds the system (intel), under where it is. */
  holder?: ReactNode;
}) {
  const realName = info?.name ?? 'Unknown system';
  const custom = system.customName || system.temporaryName;
  return (
    <header className={styles.identity} data-identity>
      {dragHandle}
      <div className={styles.identityTop}>
        <DesignationPill info={info} />
        <h2 className={styles.systemName} title={custom ? `${custom} (${realName})` : realName}>
          {custom || realName}
        </h2>
        {custom && <span className={styles.realName}>{realName}</span>}
        <span className={styles.identityActions}>
          {can.edit ? (
            <IconButton
              size="sm"
              label={system.locked ? 'Unlock position' : 'Lock position'}
              aria-pressed={system.locked}
              className={styles.lockButton}
              data-on={system.locked || undefined}
              icon={system.locked ? <Lock /> : <LockOpen />}
              onClick={() => void store.updateSystem(system.solarSystemId, { locked: !system.locked })}
            />
          ) : (
            system.locked && <Lock className={styles.lockIcon} aria-label="Locked" />
          )}
          <IconButton size="sm" label="Close" tooltipSide="left" icon={<X />} onClick={onClose} />
        </span>
      </div>
      {info && (
        <p className={styles.where}>
          <span>
            {info.regionName} › {info.constellationName}
          </span>
          <span aria-hidden>·</span>
          <span className={styles.space}>{spaceText(info)}</span>
        </p>
      )}
      {holder}
      {info && (info.effect || info.statics.length > 0) && (
        <div className={styles.wormhole}>
          {info.effect && <Effect effect={info.effect} whClass={info.whClass} />}
          <StaticsLine statics={info.statics} />
        </div>
      )}
    </header>
  );
}

const STATUS_OPTIONS = SystemStatus.options.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
  icon: (
    <span
      className={styles.statusDot}
      style={{ background: s === 'unknown' ? 'var(--dbk-color-border-strong)' : cssVar(`status-${s}`) }}
    />
  ),
}));

function Links({ info }: { info: UniverseSystemDto }) {
  const dotlan = `https://evemaps.dotlan.net/system/${encodeURIComponent(info.name.replace(/ /g, '_'))}`;
  return (
    <span className={styles.links}>
      <IconButton size="sm" asChild label="zKillboard" icon={<Skull />}>
        <a href={`https://zkillboard.com/system/${info.id}/`} target="_blank" rel="noreferrer" />
      </IconButton>
      <IconButton size="sm" asChild label="Dotlan" icon={<MapIcon />}>
        <a href={dotlan} target="_blank" rel="noreferrer" />
      </IconButton>
      {isWormholeSpace(info) && (
        <IconButton size="sm" asChild label="Anoikis" icon={<Telescope />}>
          <a
            href={`https://anoik.is/systems/${encodeURIComponent(info.name)}`}
            target="_blank"
            rel="noreferrer"
          />
        </IconButton>
      )}
    </span>
  );
}

/**
 * Sets the in-game destination for one of the viewer's characters. A character whose EVE grant
 * does not allow it is listed but cannot be picked.
 */
export function SetDestination({ solarSystemId, name }: { solarSystemId: number; name: string }) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const characters = me.data?.characters ?? [];
  if (characters.length === 0) return null;
  const able = characters.filter((c) => c.canSetWaypoints);

  const send = async (characterId: number, characterName: string) => {
    setBusy(true);
    try {
      await api(buildPath(routes.routing.waypoint.path, { characterId }), {
        method: 'POST',
        json: { solarSystemId, mode: 'destination' },
      });
      toast({ title: `Destination set to ${name}`, description: `For ${characterName}.`, tone: 'success' });
    } catch (e) {
      toast({
        title: 'Destination not set',
        description: e instanceof ApiError ? e.message : 'Network error',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const button = (props: object) => (
    <Button size="sm" variant="ghost" icon={<Navigation />} loading={busy} {...props}>
      Set destination
    </Button>
  );
  if (characters.length === 1 && able.length === 1) {
    return button({ onClick: () => void send(able[0]!.id, able[0]!.name) });
  }
  return (
    <Menu>
      <MenuTrigger asChild>{button({})}</MenuTrigger>
      <MenuContent>
        <MenuLabel>Set destination for</MenuLabel>
        {characters.map((c) => (
          <MenuItem
            key={c.id}
            disabled={!c.canSetWaypoints}
            shortcut={c.canSetWaypoints ? undefined : 'no grant'}
            onSelect={() => void send(c.id, c.name)}
          >
            {c.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Status, Labels, Tags, names, notes and links of the selected system: dense, edited in place. */
export function SystemDetails({
  system,
  info,
  labels,
  systemLabels = [],
  can,
  store,
  activity,
  focusToken,
  focusedRef,
}: {
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...), in order. */
  systemLabels?: readonly SystemLabelDto[];
  can: MapPermissions;
  store: Store;
  activity?: SystemActivity;
  /** Bumped to move focus to the name field (from the context menu). */
  focusToken: number;
  /** The last token acted on, kept by the sidebar: folding and unfolding must not focus again. */
  focusedRef: { current: number };
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusToken <= focusedRef.current) return;
    focusedRef.current = focusToken;
    nameRef.current?.focus();
  }, [focusToken, focusedRef]);
  const id = system.solarSystemId;
  const update = store.updateSystem;
  const shownTags = can.edit ? labels : labels.filter((l) => system.labelIds.includes(l.id));
  const toggleTag = (tagId: string) => {
    const on = system.labelIds.includes(tagId);
    void update(id, {
      labelIds: on ? system.labelIds.filter((x) => x !== tagId) : [...system.labelIds, tagId],
    });
  };
  const onLabels = system.systemLabelIds.filter((l) => systemLabels.some((x) => x.id === l));
  const shownLabels = can.edit ? systemLabels : systemLabels.filter((l) => onLabels.includes(l.id));
  const toggleLabel = (labelId: string) => {
    const on = onLabels.includes(labelId);
    void update(id, {
      systemLabelIds: on ? onLabels.filter((x) => x !== labelId) : [...onLabels, labelId],
    });
  };
  const showLabels = can.edit || shownLabels.length > 0 || !!system.customLabel;

  return (
    <div className={styles.details}>
      <dl className={styles.props}>
        <dt>Status</dt>
        <dd>
          {can.edit ? (
            <Select
              size="sm"
              aria-label="Status"
              className={styles.statusSelect}
              value={system.status}
              options={STATUS_OPTIONS}
              onValueChange={(status) => void update(id, { status: status as SystemStatus })}
            />
          ) : (
            <span className={styles.statusText}>
              {STATUS_OPTIONS.find((o) => o.value === system.status)?.icon}
              {STATUS_LABEL[system.status]}
            </span>
          )}
        </dd>

        {showLabels && (
          <>
            <dt>Labels</dt>
            <dd className={styles.labelChips} role="group" aria-label="Labels">
              {shownLabels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={styles.systemLabelChip}
                  aria-pressed={onLabels.includes(l.id)}
                  disabled={!can.edit}
                  title={l.description || undefined}
                  onClick={() => toggleLabel(l.id)}
                >
                  {l.name}
                </button>
              ))}
              {can.edit ? (
                <span className={styles.customLabel}>
                  <InlineText
                    label="Custom label"
                    value={system.customLabel ?? ''}
                    placeholder="Custom label"
                    maxLength={CUSTOM_LABEL_MAX}
                    onCommit={(customLabel) => void update(id, { customLabel })}
                  />
                </span>
              ) : (
                system.customLabel && (
                  <span className={styles.systemLabelChip} data-custom aria-label="Custom label">
                    {system.customLabel}
                  </span>
                )
              )}
            </dd>
          </>
        )}

        {shownTags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd className={styles.labelChips} role="group" aria-label="Tags">
              {shownTags.map((t) => {
                const on = system.labelIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.labelChip}
                    aria-pressed={on}
                    disabled={!can.edit}
                    title={t.description || undefined}
                    style={{ '--label-color': t.color } as CSSProperties}
                    onClick={() => toggleTag(t.id)}
                  >
                    <span className={styles.labelSwatch} />
                    {t.name}
                  </button>
                );
              })}
            </dd>
          </>
        )}

        {can.edit ? (
          <>
            <dt>Name</dt>
            <dd>
              <InlineText
                label="Custom name"
                inputRef={nameRef}
                value={system.customName ?? ''}
                placeholder="Add a custom name"
                maxLength={64}
                onCommit={(customName) => void update(id, { customName })}
              />
            </dd>
            <dt>Temp. name</dt>
            <dd>
              <InlineText
                label="Temporary name"
                value={system.temporaryName ?? ''}
                placeholder="Add one for this chain"
                maxLength={64}
                onCommit={(temporaryName) => void update(id, { temporaryName })}
              />
            </dd>
          </>
        ) : (
          system.temporaryName && (
            <>
              <dt>Temp. name</dt>
              <dd>{system.temporaryName}</dd>
            </>
          )
        )}

        {activity && (
          <>
            <dt>Activity</dt>
            <dd className={styles.activity}>
              {activity.kills1h !== undefined && <span>{activity.kills1h} kills 1h</span>}
              {activity.kills24h !== undefined && <span>{activity.kills24h} kills 24h</span>}
              {activity.jumps1h !== undefined && <span>{activity.jumps1h} jumps 1h</span>}
            </dd>
          </>
        )}
      </dl>

      <NotesField
        editable={can.edit}
        value={system.description}
        onCommit={(description) => void update(id, { description })}
      />

      {info && (
        <div className={styles.detailsFooter}>
          <Links info={info} />
        </div>
      )}
    </div>
  );
}
