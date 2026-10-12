'use client';

import { memo, type CSSProperties, type MouseEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  WORMHOLE_EFFECTS,
  type LabelDto,
  type MapSystemDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Bubbles, Users } from 'lucide-react';
import { PluginSlot } from '../plugins/PluginSlot';
import { characterPortraitUrl, useToast } from '../ui';
import { classPill, PILL_LABELS, STATUS_LABEL, type NearestHub } from './nodeFacts';
import { builtNodeNameSizers } from './node-sizers';
import { StaticChips } from './WormholeFacts';
import styles from './SystemNode.module.css';

export interface SystemNodeData extends Record<string, unknown> {
  mapId: string;
  system: MapSystemDto;
  /** Static data; undefined while loading. */
  info: UniverseSystemDto | undefined;
  /** The system's labels, resolved from the map's label list. */
  labels: LabelDto[];
  /** Tracked characters currently in the system. */
  characters: number;
  /** Bookmark label above the system (see `bookmarkLabel` in shared); null for none. */
  bookmark?: string | null;
  /** Known-space letters this system lets the chain out to ("H", "L", "N"); empty when none. */
  exit?: readonly string[];
  /** Nearest trade hub from an exit, from the routing API; shown under EXIT systems. */
  hub?: NearestHub | null;
  /** A connection is bubbled on this system's side. */
  bubbled?: boolean;
  /** The viewer's own character here (their main first), for the "You are here" marker. */
  me?: { characterId: number; name: string } | null;
}

export type SystemNodeType = Node<SystemNodeData, 'system'>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const MAX_LABELS = 2;
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

/** Everything the node leaves out, for its tooltip. */
export function systemTooltip(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  const name = nodeName(system, info);
  const lines = [name === info?.name || !info ? name : `${name} (${info.name})`];
  if (system.temporaryName) lines.push(`Temporary name: ${system.temporaryName}`);
  if (info)
    lines.push(`${info.regionName} · ${info.constellationName} · security ${info.security.toFixed(2)}`);
  lines.push(`Status: ${STATUS_LABEL[system.status]}`);
  if (info?.effect)
    lines.push(`${WORMHOLE_EFFECTS[info.effect].name}: ${WORMHOLE_EFFECTS[info.effect].summary}`);
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
      ? { background: pill.background, color: pill.color }
      : pill.kind === 'class'
        ? { background: cssVar(pill.token), color: cssVar('node-pill-text') }
        : undefined;
  return (
    <span className={styles.pill} data-kind={pill.kind} style={style}>
      {pill.label}
    </span>
  );
}

/**
 * The one system node: every node has the same size, so the chain lines up. The background says
 * the status and nothing else; colour elsewhere only where it means something (security, class,
 * static destinations, labels). Themes change its tokens, never its content.
 */
export const SystemNode = memo(function SystemNode({
  data,
  selected,
  isConnectable,
}: NodeProps<SystemNodeType>) {
  const { system, info, labels, characters, mapId, bookmark, exit = [], hub, bubbled, me } = data;
  const toast = useToast();
  const name = nodeName(system, info);
  const shownLabels = labels.slice(0, MAX_LABELS);
  const moreLabels = labels.length - shownLabels.length;

  const copyBookmark = (e: MouseEvent) => {
    e.stopPropagation();
    if (!bookmark) return;
    void navigator.clipboard?.writeText(bookmark).then(
      () => toast({ title: `Copied ${bookmark}`, tone: 'success', duration: 1800 }),
      () => toast({ title: 'Could not copy to the clipboard', tone: 'warning' }),
    );
  };

  return (
    <div
      className={styles.node}
      data-selected={selected || undefined}
      data-hidden={!system.visible || undefined}
      data-status={system.status}
      data-exit={exit.length > 0 || undefined}
      style={{ '--node-tint': cssVar(`node-status-${system.status}`) } as CSSProperties}
      title={systemTooltip(system, info)}
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

      {(bookmark || me || characters > 0) && (
        <div className={styles.above}>
          {bookmark ? (
            <button
              type="button"
              className={`${styles.bookmark} nodrag nopan`}
              title={`Bookmark label ${bookmark}: click to copy`}
              onClick={copyBookmark}
            >
              {bookmark}
            </button>
          ) : (
            <span />
          )}
          {me ? (
            <span className={styles.here} title={`You are here: ${me.name}`}>
              <img src={characterPortraitUrl(me.characterId, 32)} alt="" width={18} height={18} />
              You are here
              {characters > 1 && <span className={styles.hereCount}>+{characters - 1}</span>}
            </span>
          ) : (
            characters > 0 && (
              <span
                className={styles.pilots}
                title={`${characters} tracked pilot${characters === 1 ? '' : 's'} here`}
              >
                <Users aria-hidden />
                {characters}
              </span>
            )
          )}
        </div>
      )}

      <div className={styles.head}>
        <div className={styles.row} aria-hidden>
          {/* Invisible sizers: the widest pill and the longest names set every node's width. */}
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
        </div>
        <div className={`${styles.row} ${styles.fill}`}>
          <PillContent info={info} />
          <span className={styles.name}>{name}</span>
        </div>
      </div>

      <div className={`${styles.line} ${styles.fill}`}>
        <StaticChips statics={info?.statics ?? []} className={styles.statics} />
        {exit.length > 0 && (
          <span
            className={styles.exit}
            title={`Exit to ${exit.map((l) => ({ H: 'high', L: 'low', N: 'null' })[l]).join(', ')}-sec`}
          >
            EXIT {exit.join('/')}
          </span>
        )}
      </div>

      <div className={`${styles.line} ${styles.fill}`}>
        {shownLabels.length > 0 && (
          <ul className={styles.labels} aria-label="Labels">
            {shownLabels.map((l) => (
              <li
                key={l.id}
                className={styles.label}
                style={{ '--label-color': l.color } as CSSProperties}
                title={l.description ? `${l.name}: ${l.description}` : l.name}
              >
                <span className={styles.labelName}>{l.name}</span>
              </li>
            ))}
            {moreLabels > 0 && (
              <li
                className={styles.more}
                title={labels
                  .slice(MAX_LABELS)
                  .map((l) => l.name)
                  .join(', ')}
              >
                +{moreLabels}
              </li>
            )}
          </ul>
        )}
        <span className={styles.badges}>
          <PluginSlot slot="nodeBadge" props={{ mapId, solarSystemId: system.solarSystemId }} />
        </span>
      </div>

      {bubbled && (
        <span
          className={styles.bubble}
          role="img"
          aria-label="Bubbled"
          title="A connection is bubbled on this side"
        >
          <Bubbles aria-hidden />
        </span>
      )}
      {exit.length > 0 && hub && (
        <span className={styles.hub} title={`Nearest trade hub: ${hub.name}, ${hub.jumps} jumps`}>
          {hub.name} {hub.jumps}j
        </span>
      )}
    </div>
  );
});
