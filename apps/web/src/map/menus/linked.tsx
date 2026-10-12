'use client';

import { Map as MapIcon } from 'lucide-react';
import type { LinkedMapDto } from '@darkbeacon/shared';
import type { MenuItem } from '../../components/ContextMenu';

/** "Also on <map>…" of a system's menu: the other maps it is on, each opened read only. */
export function linkedMapItems(
  maps: readonly LinkedMapDto[] | undefined,
  open: (map: LinkedMapDto) => void,
): MenuItem[] {
  if (!maps || maps.length === 0) return [];
  if (maps.length === 1)
    return [
      {
        kind: 'action',
        label: `Also on ${maps[0]!.name}…`,
        icon: <MapIcon />,
        onSelect: () => open(maps[0]!),
      },
    ];
  return [
    {
      kind: 'submenu',
      label: 'Also on',
      icon: <MapIcon />,
      hint: String(maps.length),
      items: maps.map((m) => ({ kind: 'action', label: `${m.name}…`, onSelect: () => open(m) })),
    },
  ];
}
