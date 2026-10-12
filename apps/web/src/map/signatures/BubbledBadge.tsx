'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { CircleDot } from 'lucide-react';
import type { SignatureDto } from '@darkbeacon/shared';
import { usePluginRegistry } from '../../plugins/PluginSlot';
import type { PluginRegistry } from '../../plugins/registry';
import styles from './signatures.module.css';

/*
 * The node marker of a system with a bubbled signature (Wanderer: "A signature in this system is
 * bubbled"). Drawn through the node's badge slot, so the node itself does not need to know.
 */

let bubbled = new Map<string, ReadonlySet<number>>();
const listeners = new Set<() => void>();

function publish(mapId: string, systems: ReadonlySet<number>) {
  const current = bubbled.get(mapId);
  if (current && current.size === systems.size && [...systems].every((s) => current.has(s))) return;
  bubbled = new Map(bubbled).set(mapId, systems);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function BubbledBadge({ mapId, solarSystemId }: { mapId: string; solarSystemId: number }) {
  const on = useSyncExternalStore(
    subscribe,
    () => bubbled.get(mapId)?.has(solarSystemId) ?? false,
    () => false,
  );
  if (!on) return null;
  return (
    <span
      className={styles.nodeBubble}
      role="img"
      aria-label="A signature here is bubbled"
      title="A signature in this system is bubbled"
    >
      <CircleDot aria-hidden />
    </span>
  );
}

const registered = new WeakSet<PluginRegistry>();

/** Keeps the marker up to date with the map's signatures and puts it in the node badge slot once. */
export function useBubbledBadges(mapId: string, signatures: Map<string, SignatureDto>) {
  const registry = usePluginRegistry();
  useEffect(() => {
    if (registered.has(registry)) return;
    registered.add(registry);
    registry.register('darkbeacon', 'nodeBadge', BubbledBadge, { title: 'Bubbled signature', order: 10 });
  }, [registry]);
  useEffect(() => {
    const systems = new Set<number>();
    for (const s of signatures.values()) if (s.bubbled) systems.add(s.solarSystemId);
    publish(mapId, systems);
  }, [mapId, signatures]);
}
