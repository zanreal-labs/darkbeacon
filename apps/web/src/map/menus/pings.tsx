'use client';

import { Megaphone } from 'lucide-react';
import type { MapPingDto } from '@darkbeacon/shared';
import { PING_MESSAGE_MAX } from '@darkbeacon/shared';
import type { MenuItem } from '../../components/ContextMenu';

export interface PingMenuContext {
  solarSystemId: number;
  /** The map's rally ping, if there is one. */
  ping: MapPingDto | undefined;
  canEdit: boolean;
  onCall(message: string): void;
  onCancel(pingId: string): void;
}

/**
 * The rally item of a system's menu: call one here (the message typed in place), move the map's
 * rally here, or cancel it on the system that has it.
 */
export function pingMenuItems(ctx: PingMenuContext): MenuItem[] {
  if (!ctx.canEdit) return [];
  if (ctx.ping?.solarSystemId === ctx.solarSystemId)
    return [
      {
        kind: 'action',
        label: 'Cancel the rally',
        icon: <Megaphone />,
        onSelect: () => ctx.onCancel(ctx.ping!.id),
      },
    ];
  return [
    {
      kind: 'input',
      label: ctx.ping ? 'Move the rally here' : 'Call a rally here',
      icon: <Megaphone />,
      value: '',
      placeholder: 'Message, then Enter',
      maxLength: PING_MESSAGE_MAX,
      onSubmit: (message) => ctx.onCall(message.trim()),
    },
  ];
}
