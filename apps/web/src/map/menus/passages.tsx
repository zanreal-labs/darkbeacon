'use client';

import { Calculator, Footprints } from 'lucide-react';
import type { ConnectionDto } from '@darkbeacon/shared';
import type { MenuItem } from '../../components/ContextMenu';
import type { MapPermissions } from '../../lib/roles';

export interface PassageMenuContext {
  connection: ConnectionDto;
  can: MapPermissions;
  /** Opens "Log a jump" for this connection. */
  onLogJump?(): void;
  /** Opens "Plan a roll" for this connection. */
  onPlanRoll?(): void;
}

/** The passage log's items in a connection's menu: wormholes only. */
export function passageMenuItems(ctx: PassageMenuContext): MenuItem[] {
  if (ctx.connection.type !== 'wormhole') return [];
  const items: MenuItem[] = [];
  if (ctx.can.edit && ctx.onLogJump)
    items.push({ kind: 'action', label: 'Log a jump…', icon: <Footprints />, onSelect: ctx.onLogJump });
  if (ctx.onPlanRoll)
    items.push({ kind: 'action', label: 'Plan a roll…', icon: <Calculator />, onSelect: ctx.onPlanRoll });
  return items;
}
