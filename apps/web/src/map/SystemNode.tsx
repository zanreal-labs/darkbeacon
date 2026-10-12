import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { LabelDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { EyeOff, Lock, StickyNote, Users } from 'lucide-react';
import { systemClass } from '../lib/universe';
import { PluginSlot } from '../plugins/PluginSlot';
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
}

export type SystemNodeType = Node<SystemNodeData, 'system'>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

export function systemDisplayName(system: MapSystemDto, info: UniverseSystemDto | undefined): string {
  return system.customName || system.temporaryName || info?.name || String(system.solarSystemId);
}

/** The one system node. Themes change its tokens, never its content. */
export const SystemNode = memo(function SystemNode({
  data,
  selected,
  isConnectable,
}: NodeProps<SystemNodeType>) {
  const { system, info, labels, characters, mapId } = data;
  const cls = systemClass(info);
  const name = systemDisplayName(system, info);
  // The real name goes on the second line when a custom name hides it.
  const subtitle = name !== info?.name ? info?.name : info?.regionName;
  const statusColor = system.status === 'unknown' ? 'transparent' : cssVar(`status-${system.status}`);

  return (
    <div
      className={styles.node}
      data-selected={selected || undefined}
      data-hidden={!system.visible || undefined}
      data-status={system.status}
      style={{ '--status-color': statusColor } as CSSProperties}
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
      <div className={styles.row}>
        <span
          className={styles.class}
          style={{ color: cssVar(cls.token) }}
          title={
            info ? `${info.regionName} · ${info.constellationName} · ${info.security.toFixed(2)}` : undefined
          }
        >
          {cls.label}
        </span>
        <span className={styles.name}>{name}</span>
        {system.tag && <span className={styles.tag}>{system.tag}</span>}
        <span className={styles.icons}>
          {system.description.trim() && (
            <span role="img" aria-label="Has a description" title="Has notes">
              <StickyNote aria-hidden />
            </span>
          )}
          {system.locked && (
            <span role="img" aria-label="Locked" title="Locked">
              <Lock aria-hidden />
            </span>
          )}
          {!system.visible && (
            <span role="img" aria-label="Hidden" title="Hidden">
              <EyeOff aria-hidden />
            </span>
          )}
        </span>
      </div>
      {(subtitle || characters > 0) && (
        <div className={styles.sub}>
          <span className={styles.subtitle}>{subtitle}</span>
          {characters > 0 && (
            <span className={styles.characters} title={`${characters} tracked here`}>
              <Users aria-hidden />
              {characters}
            </span>
          )}
        </div>
      )}
      {labels.length > 0 && (
        <ul className={styles.labels}>
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
      <div className={styles.badges}>
        <PluginSlot slot="nodeBadge" props={{ mapId, solarSystemId: system.solarSystemId }} />
      </div>
    </div>
  );
});
