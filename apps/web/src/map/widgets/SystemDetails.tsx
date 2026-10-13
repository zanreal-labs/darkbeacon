'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Lock, Map as MapIcon, Orbit, Pencil, Skull, Telescope } from 'lucide-react';
import {
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  wormholeDestination,
  type LabelDto,
  type MapSystemDto,
  type SystemLabelDto,
  type SystemStatus,
  type UniverseSystemDto,
  type WormholeEffect,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Markdown } from '../../components/Markdown';
import { IconButton, Tooltip } from '../../ui';
import { classPill, shownSecurity, STATUS_LABEL } from '../nodeFacts';
import node from '../SystemNode.module.css';
import { destinationToken } from '../WormholeFacts';
import { SystemIntel } from './ActivitySection';
import { EffectTable } from './EffectTable';
import { WidgetWindow } from './WidgetWindow';
import styles from './widgets.module.css';

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

/**
 * The node's designation pill: class or security, in its EVE colour. The space in words is its
 * tooltip and what screen readers hear; the pill alone says it to the eye.
 */
export function DesignationPill({ info }: { info: UniverseSystemDto | undefined }) {
  const pill = classPill(info);
  const style =
    pill.kind === 'security'
      ? { background: pill.background }
      : pill.kind === 'class'
        ? { background: cssVar(pill.token) }
        : undefined;
  const words = info ? spaceText(info) : undefined;
  return (
    <span className={styles.pill} data-kind={pill.kind} style={style} title={words}>
      <span aria-hidden={words ? true : undefined}>{pill.label}</span>
      {words && <span className="sr-only">{words}</span>}
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

export const statusColor = (s: SystemStatus) =>
  s === 'unknown' ? 'var(--dbk-color-border-strong)' : cssVar(`status-${s}`);

/** The status as a small coloured chip, read only (it is changed in Edit system). */
function StatusBadge({ status }: { status: SystemStatus }) {
  if (status === 'unknown') return null;
  return (
    <span
      className={styles.statusChip}
      data-status={status}
      role="img"
      aria-label={`Status: ${STATUS_LABEL[status]}`}
    >
      <span className={styles.statusDot} style={{ background: statusColor(status) }} />
      <span aria-hidden>{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** zKillboard, Dotlan and (in wormhole space) Anoikis: in System info's title bar. */
export function SystemLinks({ info }: { info: UniverseSystemDto }) {
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

/** The system's Labels, custom label and Tags as the map draws them, smaller. */
export function SystemChips({
  system,
  labels,
  systemLabels,
}: {
  system: MapSystemDto;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
}) {
  const own = systemLabels.filter((l) => system.systemLabelIds.includes(l.id));
  const tags = labels.filter((t) => system.labelIds.includes(t.id));
  if (own.length === 0 && !system.customLabel && tags.length === 0 && !system.temporaryName) return null;
  return (
    <div className={styles.chips}>
      {(own.length > 0 || system.customLabel) && (
        <ul className={styles.chipList} aria-label="Labels">
          {own.map((l) => (
            <li
              key={l.id}
              className={`${node.systemLabel} ${styles.chip}`}
              title={l.description ? `${l.name}: ${l.description}` : `Label ${l.name}`}
            >
              {l.name}
            </li>
          ))}
          {system.customLabel && (
            <li className={`${node.systemLabel} ${styles.chip}`} data-custom title="Custom label">
              {system.customLabel}
            </li>
          )}
        </ul>
      )}
      {tags.length > 0 && (
        <ul className={styles.chipList} aria-label="Tags">
          {tags.map((t) => (
            <li
              key={t.id}
              className={`${node.label} ${styles.chip}`}
              style={{ '--label-color': t.color } as CSSProperties}
              title={t.description ? `${t.name}: ${t.description}` : t.name}
            >
              {t.name}
            </li>
          ))}
        </ul>
      )}
      {system.temporaryName && (
        <span className={styles.tempName} title="Temporary name">
          temp <strong>{system.temporaryName}</strong>
        </span>
      )}
    </div>
  );
}

/** The notes, two lines of them; a click shows them all (links open). */
function NotesExcerpt({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div
      ref={ref}
      className={styles.notesExcerpt}
      data-open={open || undefined}
      data-long={long || undefined}
      aria-label="Notes"
      role={long ? 'button' : undefined}
      tabIndex={long ? 0 : undefined}
      aria-expanded={long ? open : undefined}
      title={long && !open ? 'Show all notes' : undefined}
      onClick={(e) => {
        if (!long || (e.target as HTMLElement).closest('a')) return;
        setOpen((o) => !o);
      }}
      onKeyDown={(e) => {
        if (long && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <Markdown text={text} />
    </div>
  );
}

/**
 * The System info widget: what a pilot reads at a glance, nothing to edit. The title bar is the
 * system (pill, name, the real name under a custom one) with its status and the links out; under
 * it where it is with the effect and the statics, the system's Labels and Tags as the map draws
 * them, two lines of notes, and its kill intel in numbers. Editing is the Edit system dialog (the
 * pencil, the context menu, a double-click on the system).
 */
export function SystemInfoWidget({
  mapId,
  system,
  info,
  labels,
  systemLabels,
  canEdit,
  onEdit,
  note,
}: {
  mapId: string;
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
  canEdit: boolean;
  onEdit?(): void;
  /** One quiet line (where a merged system comes from). */
  note?: ReactNode;
}) {
  const realName = info?.name ?? 'Unknown system';
  const custom = system.customName;
  return (
    <WidgetWindow
      id="info"
      title="System info"
      heading={
        <span className={styles.heading} data-identity>
          <DesignationPill info={info} />
          <h2 className={styles.systemName} title={custom ? `${custom} (${realName})` : realName}>
            {custom || realName}
          </h2>
          {custom && <span className={styles.realName}>{realName}</span>}
          <StatusBadge status={system.status} />
          {system.locked && <Lock className={styles.lockIcon} aria-label="Locked" />}
        </span>
      }
      actions={
        <>
          {info && <SystemLinks info={info} />}
          {canEdit && onEdit && (
            <IconButton size="sm" label="Edit system" tooltipSide="left" icon={<Pencil />} onClick={onEdit} />
          )}
        </>
      }
    >
      {info && (
        <div className={styles.where}>
          {/* A wormhole's region and constellation are codes (C-R00014) that tell a pilot nothing. */}
          {!isWormholeSpace(info) && (
            <span className={styles.place}>
              {info.regionName} › {info.constellationName}
            </span>
          )}
          {info.effect && <Effect effect={info.effect} whClass={info.whClass} />}
          <StaticsLine statics={info.statics} />
        </div>
      )}
      <SystemChips system={system} labels={labels} systemLabels={systemLabels} />
      {system.description && <NotesExcerpt key={system.solarSystemId} text={system.description} />}
      <SystemIntel mapId={mapId} solarSystemId={system.solarSystemId} />
      {note}
    </WidgetWindow>
  );
}
