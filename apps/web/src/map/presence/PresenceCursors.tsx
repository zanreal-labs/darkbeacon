'use client';

import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useInternalNode, useStore, ViewportPortal, type InternalNode } from '@xyflow/react';
import type { MapPoint, PresencePeerDto } from '@darkbeacon/shared';
import { activityText } from '../../lib/presence-activity';
import { floatingEnds, type Rect } from '../geometry';
import styles from './presence.module.css';

/** How long a cursor takes to fade once its owner's action (and grace time) ended. */
export const CURSOR_FADE_MS = 450;

type Active = PresencePeerDto & { activity: NonNullable<PresencePeerDto['activity']> };

const isActive = (peer: PresencePeerDto): peer is Active => !!peer.activity;

/**
 * Other people's pointers on the map, only while they are changing something (moving or linking
 * systems, editing, pasting a scan) and a short grace after: an arrow with their name and what
 * they do, and an outline in their colour on what they change. Their cursor then fades. Moving
 * the mouse, hovering or selecting shows nothing. Cursors keep their size at any zoom and never
 * catch the pointer; without a cursor (it left their canvas, or they do not share it) the tag
 * sits on the system or connection they change.
 */
export const PresenceCursors = memo(function PresenceCursors({
  peers,
}: {
  peers: readonly PresencePeerDto[];
}) {
  const zoom = useStore((s) => s.transform[2]);
  // Peers whose activity just ended, as they were last seen: drawn fading out.
  const [previous, setPrevious] = useState(peers);
  const [fading, setFading] = useState<ReadonlyMap<string, Active>>(new Map());
  if (previous !== peers) {
    const now = new Map(peers.filter(isActive).map((p) => [p.key, p]));
    const ended = previous.filter((p): p is Active => isActive(p) && !now.has(p.key));
    const back = [...fading.keys()].some((key) => now.has(key));
    setPrevious(peers);
    if (ended.length > 0 || back) {
      const next = new Map([...fading].filter(([key]) => !now.has(key)));
      for (const p of ended) next.set(p.key, p);
      setFading(next);
    }
  }
  useEffect(() => {
    if (fading.size === 0) return;
    const timer = setTimeout(() => setFading(new Map()), CURSOR_FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);

  const shown = [
    ...peers.filter(isActive).map((peer) => ({ peer, ending: false })),
    ...[...fading.values()].map((peer) => ({ peer, ending: true })),
  ];
  if (shown.length === 0) return null;
  return (
    <ViewportPortal>
      {shown.map(({ peer, ending }) => (
        <PeerActivity key={peer.key} peer={peer} ending={ending} zoom={zoom} />
      ))}
    </ViewportPortal>
  );
});

function PeerActivity({ peer, ending, zoom }: { peer: Active; ending: boolean; zoom: number }) {
  const target = peer.activity.target ?? null;
  const vars = { '--who': `var(--dbk-presence-${peer.color})` } as CSSProperties;
  // Where they point, else on what they change.
  const tag = (at: MapPoint | null) => {
    const point = peer.cursor ?? at;
    if (!point) return null;
    return (
      <div
        className={styles.cursor}
        data-presence-cursor={peer.accountId}
        data-ending={ending || undefined}
        aria-hidden
        style={{ ...vars, transform: `translate(${point.x}px, ${point.y}px) scale(${1 / zoom})` }}
      >
        <svg viewBox="0 0 16 20" width={16} height={20} className={styles.arrow}>
          <path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" />
        </svg>
        <span className={styles.tag}>
          <span className={styles.name}>{peer.characterName ?? peer.name}</span>
          <span className={styles.verb} data-presence-verb>
            {activityText(peer.activity)}
          </span>
        </span>
      </div>
    );
  };
  if (target?.kind === 'system')
    return <SystemMark id={target.id} peer={peer} ending={ending} vars={vars} tag={tag} />;
  if (target?.kind === 'connection')
    return <ConnectionMark id={target.id} ending={ending} vars={vars} tag={tag} />;
  return tag(null);
}

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

/** The system someone changes, outlined in their colour (where they drag it, while they do). */
function SystemMark({
  id,
  peer,
  ending,
  vars,
  tag,
}: {
  id: string;
  peer: Active;
  ending: boolean;
  vars: CSSProperties;
  tag(at: MapPoint | null): ReactNode;
}) {
  const node = useInternalNode(id);
  if (!node) return tag(null);
  const rect = rectOf(node);
  const dragged = peer.drag?.systems.find((s) => String(s.solarSystemId) === id);
  if (dragged) {
    rect.x = dragged.x;
    rect.y = dragged.y;
  }
  return (
    <>
      <div
        className={styles.outline}
        data-presence-outline={id}
        data-ending={ending || undefined}
        aria-hidden
        style={{
          ...vars,
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: rect.width,
          height: rect.height,
        }}
      />
      {tag({ x: rect.x + rect.width - 10, y: rect.y + rect.height - 8 })}
    </>
  );
}

/** The connection someone changes: a soft band in their colour along it. */
function ConnectionMark({
  id,
  ending,
  vars,
  tag,
}: {
  id: string;
  ending: boolean;
  vars: CSSProperties;
  tag(at: MapPoint | null): ReactNode;
}) {
  const edge = useStore((s) => s.edgeLookup.get(id));
  const source = useInternalNode(edge?.source ?? '');
  const target = useInternalNode(edge?.target ?? '');
  if (!edge || !source || !target) return tag(null);
  const { from, to } = floatingEnds(rectOf(source), rectOf(target));
  return (
    <>
      <svg
        className={styles.band}
        data-presence-outline={id}
        data-ending={ending || undefined}
        aria-hidden
        style={vars}
        width={1}
        height={1}
      >
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      </svg>
      {tag({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })}
    </>
  );
}
