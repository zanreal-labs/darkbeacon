'use client';

import { Copy, ExternalLink } from 'lucide-react';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import type { MenuItem } from '../../components/ContextMenu';
import { dotlanUrl, type DotlanTarget } from '../canvas/prefs';
import { isWormholeSpace } from '../sidebar/SystemDetails';

export interface LinksMenuContext {
  /** The system as the universe knows it; without it only the name can be copied. */
  info: UniverseSystemDto | undefined;
  /** The name shown on the map (custom name or the real one), for "Copy name". */
  name: string;
  dotlan: DotlanTarget;
  onCopyName(): void;
}

const open = (url: string) => () => void window.open(url, '_blank', 'noopener,noreferrer');

/**
 * Links ▸ of a system's menu (Wanderer's fast system actions): zKillboard, Dotlan (where the
 * viewer's setting sends it), Anoikis for wormholes, and copying the name.
 */
export function linksMenu(ctx: LinksMenuContext): MenuItem[] {
  const { info } = ctx;
  const wormhole = isWormholeSpace(info);
  const items: MenuItem[] = [];
  if (info) {
    items.push(
      { kind: 'action', label: 'zKillboard', onSelect: open(`https://zkillboard.com/system/${info.id}/`) },
      {
        kind: 'action',
        label: 'Dotlan',
        onSelect: open(dotlanUrl(ctx.dotlan, { name: info.name, regionName: info.regionName, wormhole })),
      },
    );
    if (wormhole)
      items.push({
        kind: 'action',
        label: 'Anoikis',
        onSelect: open(`https://anoik.is/systems/${encodeURIComponent(info.name)}`),
      });
    items.push({ kind: 'separator' });
  }
  items.push({ kind: 'action', label: 'Copy name', icon: <Copy />, onSelect: ctx.onCopyName });
  return [{ kind: 'submenu', label: 'Links', icon: <ExternalLink />, items }];
}
