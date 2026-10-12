'use client';

import { memo, type CSSProperties, type MouseEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_EFFECTS,
  wormholeDestination,
  type LabelDto,
  type MapSystemDto,
  type SystemIntelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Lock, Users } from 'lucide-react';
import { PluginSlot } from '../plugins/PluginSlot';
import { useToast } from '../ui';
import {
  classPill,
  PILL_LABELS,
  ROUTE_SPACE_TEXT,
  ROUTE_SPACE_TOKEN,
  STATUS_BORDER,
  STATUS_LABEL,
  type NearestHub,
} from './nodeFacts';
import { builtNodeNameSizers } from './node-sizers';
import { EffectDot, NodeKills, NodeKillsSizer, NodeSovereignty, type StandingTone } from './NodeIntel';
import { destinationToken } from './WormholeFacts';
import styles from './SystemNode.module.css';

export interface SystemNodeData extends Record<string, unknown> {
  mapId: string;
  system: MapSystemDto;
  /** Static data; undefined while loading. */
  info: UniverseSystemDto | undefined;
  /** The system's labels, resolved from the map's label list (shown above the node). */
  labels: LabelDto[];
  /** Tracked characters currently in the system. */
  characters: number;
  /** Bookmark label above the system (see `bookmarkLabel` in shared); null for none. */
  bookmark?: string | null;
  /** For an exit to known space: the nearest hub, from the routing API (shown below the node). */
  hub?: NearestHub | null;
  /** One of the viewer's own characters is here: the pilot count is in the accent colour. */
  mine?: boolean;
  /** Sovereignty and kills of the last hour (system intel); undefined while loading. */
  intel?: SystemIntelDto;
  /** How the viewer stands towards the holder (contacts), for the sovereignty ticker's colour. */
  standing?: StandingTone;
  /** A kill just came in: the node rings softly for a moment. */
  pulse?: boolean;
}

export type SystemNodeType = Node<SystemNodeData, 'system'>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
/** Computed at build time from the universe dataset; sizes every node the same. */
const NAME_SIZERS = builtNodeNameSizers();

/** What the node calls the system: its custom name, else a temporary name, else the real name. */
export function systemDisplayName(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  return system.customName || system.temporaryName || info?.name || String(system.solarSystemId);
}

/**
 * The name on the node: a custom name, else the real one. A temporary name is shown as the
 * bookmark label above the node instead (see `bookmarkLabel`).
 */
export function nodeName(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  return system.customName || info?.name || String(system.solarSystemId);
}

/** K-space and Pochven: where the node names the region (wormholes show their statics instead). */
function isKnownSpace(info: UniverseSystemDto): boolean {
  const c = info.whClass;
  return !(c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18)));
}

/** Everything the node leaves out, for its tooltip. */
export function systemTooltip(
  system: MapSystemDto,
  info: UniverseSystemDto | undefined,
  intel?: SystemIntelDto,
): string {
  const name = nodeName(system, info);
  const lines = [name === info?.name || !info ? name : `${name} (${info.name})`];
  if (system.temporaryName) lines.push(`Temporary name: ${system.temporaryName}`);
  if (info)
    lines.push(`${info.regionName} · ${info.constellationName} · security ${info.security.toFixed(2)}`);
  lines.push(`Status: ${STATUS_LABEL[system.status]}`);
  if (info?.effect)
    lines.push(`${WORMHOLE_EFFECTS[info.effect].name}: ${WORMHOLE_EFFECTS[info.effect].summary}`);
  if (intel?.sovereignty?.holder.name)
    lines.push(
      `${intel.sovereignty.kind === 'faction' ? 'Faction space' : 'Sovereignty'}: ${intel.sovereignty.holder.name}`,
    );
  if (intel && intel.kills1h > 0) lines.push(`Kills in the last hour: ${intel.kills1h}`);
  if (info?.statics.length) lines.push(`Statics: ${info.statics.join(', ')}`);
  if (system.tag) lines.push(`Tag: ${system.tag}`);
  if (system.locked) lines.push('Locked');
  if (!system.visible) lines.push('Hidden from the map');
  if (system.description.trim()) lines.push(`Notes: ${system.description.trim().slice(0, 200)}`);
  return lines.join('\n');
}

function PillContent({ info }: { info: UniverseSystemDto | undefined }) {
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

/** Statics as plain text: the hole type, then where it leads in that place's colour ("D845 HS"). */
function StaticsText({ statics }: { statics: readonly string[] }) {
  if (statics.length === 0) return null;
  return (
    <ul className={styles.statics} aria-label="Statics">
      {statics.map((type) => {
        const to = wormholeDestination(type);
        const where = to ? WORMHOLE_DESTINATION_LABEL[to] : null;
        return (
          <li key={type} title={where ? `Static ${type} to ${where}` : `Static ${type}`}>
            <span className={styles.code}>{type}</span>
            {where && (
              <span className={styles.to} style={{ color: cssVar(destinationToken(to)) }}>
                {where}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The one system node, built for a glance: a neutral box whose 3 px border carries the status;
 * the designation pill and the name, the pilot count; the statics. The bookmark code and labels
 * sit above it, the nearest hub of an exit below it. Everything else is in the tooltip.
 */
export const SystemNode = memo(function SystemNode({
  data,
  selected,
  isConnectable,
}: NodeProps<SystemNodeType>) {
  const { system, info, labels, characters, mapId, bookmark, hub, mine, intel, standing, pulse } = data;
  const toast = useToast();
  const name = nodeName(system, info);

  const copyBookmark = (e: MouseEvent) => {
    e.stopPropagation();
    if (!bookmark) return;
    void navigator.clipboard?.writeText(bookmark).then(
      () => toast({ title: `Copied ${bookmark}`, tone: 'success', duration: 1800 }),
      () => toast({ title: 'Could not copy to the clipboard', tone: 'warning' }),
    );
  };
  const square = hub?.space ? ROUTE_SPACE_TOKEN[hub.space] : undefined;

  return (
    <div
      className={styles.node}
      data-selected={selected || undefined}
      data-hidden={!system.visible || undefined}
      data-status={system.status}
      data-pulse={pulse || undefined}
      style={{ '--node-status': cssVar(STATUS_BORDER[system.status]) } as CSSProperties}
      title={systemTooltip(system, info, intel)}
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          isConnectable={isConnectable}
          className={styles.handle}
        />
      ))}

      <div className={styles.above}>
        {bookmark && (
          <button
            type="button"
            className={`${styles.bookmark} nodrag nopan`}
            title={`Bookmark ${bookmark}: click to copy`}
            onClick={copyBookmark}
          >
            {bookmark}
          </button>
        )}
        {labels.length > 0 && (
          <ul className={styles.labels} aria-label="Labels">
            {labels.map((l) => (
              <li
                key={l.id}
                className={styles.label}
                style={{ '--label-color': l.color } as CSSProperties}
                title={l.description ? `${l.name}: ${l.description}` : l.name}
              >
                {l.name}
              </li>
            ))}
          </ul>
        )}
        <span className={styles.badges}>
          <PluginSlot slot="nodeBadge" props={{ mapId, solarSystemId: system.solarSystemId }} />
        </span>
      </div>

      <div className={styles.head}>
        <div className={styles.row} aria-hidden>
          {/* Invisible sizers: the widest pill, the longest names and a pilot count set every node's width. */}
          <span className={styles.stack}>
            {PILL_LABELS.map((l) => (
              <span key={l} className={`${styles.pill} ${styles.sizer}`}>
                {l}
              </span>
            ))}
          </span>
          <span className={styles.stack}>
            {NAME_SIZERS.map((n) => (
              <span key={n} className={`${styles.name} ${styles.sizer}`}>
                {n}
              </span>
            ))}
          </span>
          <span className={`${styles.effectSizer} ${styles.sizer}`} />
          <span className={styles.end}>
            <NodeKillsSizer className={styles.sizer} />
            <span className={`${styles.pilots} ${styles.sizer}`}>
              <Users aria-hidden />
              99
            </span>
          </span>
        </div>
        <div className={`${styles.row} ${styles.fill}`}>
          <PillContent info={info} />
          <span className={styles.name}>{name}</span>
          <EffectDot effect={info?.effect} />
          <span className={styles.end}>
            <NodeKills mapId={mapId} solarSystemId={system.solarSystemId} kills={intel?.kills1h ?? 0} />
            {characters > 0 && (
              <span
                className={styles.pilots}
                data-mine={mine || undefined}
                title={`${characters} tracked pilot${characters === 1 ? '' : 's'} here${mine ? ', you among them' : ''}`}
              >
                <Users aria-hidden />
                {characters}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className={`${styles.line} ${styles.fill}`}>
        <StaticsText statics={info?.statics ?? []} />
        {info && !system.customName && isKnownSpace(info) && (
          <span className={styles.region} title={`${info.regionName} › ${info.constellationName}`}>
            {info.whClass === 25 ? info.constellationName : info.regionName}
          </span>
        )}
        <span className={styles.corner}>
          {system.locked && (
            <span className={styles.lock} title="Locked: cannot be moved or removed" data-locked>
              <Lock aria-label="Locked" />
            </span>
          )}
          <NodeSovereignty intel={intel} standing={standing} />
        </span>
      </div>

      {hub && (
        <span
          className={styles.hub}
          title={`Nearest hub: ${hub.name}, ${hub.jumps} jump${hub.jumps === 1 ? '' : 's'}${hub.space ? `, ${ROUTE_SPACE_TEXT[hub.space]}` : ''}`}
        >
          {hub.name} {hub.jumps}j
          {square && (
            <span
              className={styles.square}
              data-space={hub.space}
              style={{ background: cssVar(square) }}
              aria-hidden
            />
          )}
        </span>
      )}
    </div>
  );
});
