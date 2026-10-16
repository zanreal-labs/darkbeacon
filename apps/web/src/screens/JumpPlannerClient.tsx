'use client';

import dynamic from 'next/dynamic';
import type { JumpMetaDto } from '@darkbeacon/shared';
import { JumpLoading } from './JumpLoading';

// The star map draws on a canvas sized to the window, so the planner renders in the browser only.
const JumpPage = dynamic(() => import('./JumpPage').then((m) => m.JumpPage), {
  ssr: false,
  loading: () => <JumpLoading />,
});

/** The viewer's map as far as the planner cares: its name, its chain's exits and its systems. */
export interface PlannerMap {
  map: string;
  /** Known-space systems the chain reaches through a wormhole. */
  exits: number[];
  /** Every visible system on the map, wormholes included (the planner keeps known space). */
  systems: number[];
}

export function JumpPlannerClient({ meta, chain }: { meta: JumpMetaDto; chain: PlannerMap | null }) {
  return <JumpPage meta={meta} chain={chain} />;
}
