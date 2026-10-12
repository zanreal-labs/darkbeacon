'use client';

import { useCallback, useState } from 'react';
import type { MapSourceDto } from '@darkbeacon/shared';
import { Layers } from 'lucide-react';
import { IconButton, Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from '../../ui';

const storageKey = (mapId: string) => `dbk-map-hidden-sources:${mapId}`;

function read(mapId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(mapId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Sources this viewer hides on a merged map (kept in this browser only; nothing changes on the server). */
export function useHiddenSources(mapId: string) {
  const [hidden, setHidden] = useState<Set<string>>(() =>
    typeof window === 'undefined' ? new Set() : read(mapId),
  );
  const toggle = useCallback(
    (id: string) =>
      setHidden((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        try {
          window.localStorage.setItem(storageKey(mapId), JSON.stringify([...next]));
        } catch {
          // Private windows: the filter lasts for this page only.
        }
        return next;
      }),
    [mapId],
  );
  return { hidden, toggle };
}

/** A small menu in the map's top bar: which merged maps to show. Shown only with two or more. */
export function SourceFilter({
  sources,
  hidden,
  onToggle,
  className,
}: {
  sources: readonly MapSourceDto[];
  hidden: ReadonlySet<string>;
  onToggle(id: string): void;
  className?: string;
}) {
  if (sources.length < 2) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          variant="secondary"
          className={className}
          label={hidden.size > 0 ? `Merged maps (${hidden.size} hidden)` : 'Merged maps'}
          icon={<Layers />}
          tooltip={false}
        />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Show maps</MenuLabel>
        {sources.map((source) => (
          <MenuCheckboxItem
            key={source.id}
            checked={!hidden.has(source.id)}
            onCheckedChange={() => onToggle(source.id)}
            onSelect={(e) => e.preventDefault()}
          >
            {source.instanceName ? `${source.name} (${source.instanceName})` : source.name}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
