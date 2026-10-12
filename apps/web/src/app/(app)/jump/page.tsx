import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { buildPath, routes } from '@darkbeacon/shared';
import { meKey } from '../../../lib/session-keys';
import { getLanding, getMapBySlug, getMe, prefilled, serverGet } from '../../../server/api';
import { JumpLoading } from '../../../screens/JumpLoading';
import { JumpPlannerClient, type ChainExits } from '../../../screens/JumpPlannerClient';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Jump planner · Darkbeacon' };

/**
 * `/jump`: the jump planner, a map of all known space for capital jump routes. The shell and a
 * loading state are prerendered; the ships and the dataset's version stream in, the map data is
 * fetched (and cached for good) by the browser.
 */
export default function JumpRoute() {
  return (
    <Suspense fallback={<JumpLoading />}>
      <Planner />
    </Suspense>
  );
}

async function Planner() {
  const [me, meta, chain] = await Promise.all([
    getMe(),
    serverGet(routes.jumps.meta).catch(() => null),
    chainExits(),
  ]);
  if (!me) return <SignInRedirect />;
  if (!meta) return <JumpLoading label="The jump planner is not available right now" />;
  return (
    <HydrationBoundary state={prefilled([[meKey, me]])}>
      <JumpPlannerClient meta={meta} chain={chain} />
    </HydrationBoundary>
  );
}

/**
 * Where the viewer's chain (the map `/` opens) touches known space, so a route can start at an
 * exit. Nothing when there is no such map or it has no exits; never an error for the page.
 */
async function chainExits(): Promise<ChainExits | null> {
  try {
    const { slug } = await getLanding();
    if (!slug) return null;
    const map = await getMapBySlug(slug);
    if (!map) return null;
    const { exits } = await serverGet(
      routes.routing.exits,
      buildPath(routes.routing.exits.path, { mapId: map.id }),
    );
    const systems = exits.filter((e) => e.kind === 'connected').map((e) => e.solarSystemId);
    return systems.length > 0 ? { map: map.name, systems } : null;
  } catch {
    return null;
  }
}
