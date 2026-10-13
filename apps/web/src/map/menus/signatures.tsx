'use client';

import { BookOpen, Link2 } from 'lucide-react';
import type { ConnectionDto } from '@darkbeacon/shared';
import type { MenuItem } from '../../components/ContextMenu';
import type { MapPermissions } from '../../lib/roles';
import { openLinkConnection } from '../signatures/SignatureLayer';
import { openWormholeReference } from '../../reference/open';

/** Signature items of the connection menu: link the signatures of both ends. */
export function connectionSignatureItems(connection: ConnectionDto, can: MapPermissions): MenuItem[] {
  if (!can.edit || connection.type !== 'wormhole') return [];
  return [
    {
      kind: 'action',
      label: 'Link signatures…',
      icon: <Link2 />,
      onSelect: () => openLinkConnection(connection.id),
    },
  ];
}

/** Signature items of the canvas menu: the wormhole types reference. */
export function paneSignatureItems(): MenuItem[] {
  return [
    { kind: 'action', label: 'Wormhole types…', icon: <BookOpen />, onSelect: () => openWormholeReference() },
  ];
}
