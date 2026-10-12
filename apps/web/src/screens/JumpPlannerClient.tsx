'use client';

import dynamic from 'next/dynamic';
import type { JumpMetaDto } from '@darkbeacon/shared';
import { JumpLoading } from './JumpLoading';

// The star map draws on a canvas sized to the window, so the planner renders in the browser only.
const JumpPage = dynamic(() => import('./JumpPage').then((m) => m.JumpPage), {
  ssr: false,
  loading: () => <JumpLoading />,
});

/** Known-space systems the viewer's chain reaches through a wormhole, and the map's name. */
export interface ChainExits {
  map: string;
  systems: number[];
}

export function JumpPlannerClient({ meta, chain }: { meta: JumpMetaDto; chain: ChainExits | null }) {
  return <JumpPage meta={meta} chain={chain} />;
}
