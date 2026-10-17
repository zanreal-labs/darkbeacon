import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { buildPath, routes, type MapSnapshot } from '@darkbeacon/shared';
import { meKey, myTrackingKey } from '../../../lib/session-keys';
import { getLanding, getMapBySlug, getMe, prefilled, serverGet } from '../../../server/api';
import { JumpLoading } from '../../../screens/JumpLoading';
import { JumpPlannerClient, type PlannerMap } from '../../../screens/JumpPlannerClient';
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
  const [me, meta, chain, tracking] = await Promise.all([
    getMe(),
    serverGet(routes.jumps.meta).catch(() => null),
    plannerMap(),
    // Where my characters are, so the pickers suggest it on the first focus.
    serverGet(routes.characters.myTracking).catch(() => undefined),
  ]);
  if (!me) return <SignInRedirect />;
  if (!meta) return <JumpLoading label="The jump planner is not available right now" />;
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [myTrackingKey, tracking],
      ])}
    >
      <JumpPlannerClient meta={meta} chain={chain} />
    </HydrationBoundary>
  );
}

/**
 * The viewer's map (the one `/` opens) as far as it touches known space: the systems on it and
 * the exits of its chain, for the pickers' suggestions. Nothing when there is no such map; never
 * an error for the page.
 */
async function plannerMap(): Promise<PlannerMap | null> {
  try {
    const { slug } = await getLanding();
    if (!slug) return null;
    const map = await getMapBySlug(slug);
    if (!map) return null;
    const snapshot = await serverGet(
      routes.realtime.snapshot,
      buildPath(routes.realtime.snapshot.path, { stream: `map:${map.id}` }),
    );
    const data = snapshot.data as MapSnapshot;
    // The snapshot carries the exits for those who may read routes; ask for them otherwise.
    const exits =
      data.exits ??
      (
        await serverGet(routes.routing.exits, buildPath(routes.routing.exits.path, { mapId: map.id })).catch(
          () => null,
        )
      )?.exits ??
      [];
    return {
      map: map.name,
      exits: exits.filter((e) => e.kind === 'connected').map((e) => e.solarSystemId),
      // Wormholes too: the planner keeps the known-space systems it has on its star map.
      systems: (data.systems ?? []).filter((s) => s.visible).map((s) => s.solarSystemId),
    };
  } catch {
    return null;
  }
}
