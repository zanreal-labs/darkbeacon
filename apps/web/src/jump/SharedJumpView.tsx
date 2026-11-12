'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Route } from 'lucide-react';
import { routes, type JumpShareViewDto, type JumpUniverseDto } from '@darkbeacon/shared';
import { api } from '../lib/api';
import { LogoMark } from '../shell/Logo';
import { Badge, Button, ErrorState } from '../ui';
import type { Overlay, RouteLeg } from './draw';
import { formatLy, formatRange } from './format';
import { RouteSummary, RouteSystems } from './JumpPanel';
import { buildStarModel, type StarModel } from './model';
import { StarMap, type StarMapHandle } from './StarMap';
import { JumpLoading } from '../screens/JumpLoading';
import publicStyles from '../screens/PublicMap.module.css';
import styles from './jump.module.css';

const PHONE = '(max-width: 767px)';
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

/**
 * A shared jump route, read-only: the star map with the route on it and the route's legs and
 * numbers beside it, as the sharer planned it (ship, stops, skill levels, options). Anyone with
 * the link sees it; nothing here edits, and nothing about the sharer is shown.
 */
export function SharedJumpView({ view }: { view: JumpShareViewDto }) {
  const universe = useQuery({
    queryKey: ['jumps', 'public-universe', view.universeVersion],
    queryFn: () =>
      api<JumpUniverseDto>(
        `${routes.public.jumpUniverse.path}?v=${encodeURIComponent(view.universeVersion)}`,
      ),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const model = useMemo(() => (universe.data ? buildStarModel(universe.data) : null), [universe.data]);
  if (universe.isError)
    return (
      <div className={publicStyles.standalone}>
        <ErrorState
          title="The star map did not load"
          error={universe.error}
          onRetry={() => void universe.refetch()}
        />
      </div>
    );
  if (!model) return <JumpLoading />;
  return <Shared view={view} model={model} />;
}

function Shared({ view, model }: { view: JumpShareViewDto; model: StarModel }) {
  const { plan, request } = view;
  const route = plan.route;
  const mapRef = useRef<StarMapHandle>(null);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(PHONE);
    if (!media) return;
    const update = () => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const legs: RouteLeg[] = useMemo(
    () =>
      route?.legs.map((leg) => ({
        from: model.indexById.get(leg.from.id)!,
        to: model.indexById.get(leg.to.id)!,
        kind: leg.kind,
      })) ?? [],
    [route, model],
  );
  const origin = model.indexById.get(request.origin) ?? null;
  const destination = model.indexById.get(request.destination) ?? null;
  const overlay: Overlay = useMemo(
    () => ({
      origin,
      destination,
      hover: null,
      rangeFrom: null,
      rangeLy: null,
      reachable: null,
      route: legs.length > 0 ? legs : null,
      alternatives: [],
      activeLeg,
      avoided: new Set<number>(),
      exits: new Set<number>(),
    }),
    [origin, destination, legs, activeLeg],
  );
  useEffect(() => {
    if (legs.length > 0) mapRef.current?.fit([legs[0]!.from, ...legs.map((l) => l.to)]);
  }, [legs]);

  const name = (id: number) => {
    const i = model.indexById.get(id);
    return i === undefined ? String(id) : model.names[i]!;
  };
  const stops = [
    request.origin,
    ...(request.via ?? []),
    request.destination,
    ...(request.roundTrip ? [request.origin] : []),
  ].map(name);
  const skills = [
    `JDC ${ROMAN[request.skills?.jdc ?? 5]}`,
    `JFC ${ROMAN[request.skills?.jfc ?? 4]}`,
    ...(plan.ship.hull === 'jump_freighter' ? [`JF ${ROMAN[request.skills?.jf ?? 4]}`] : []),
  ].join(' · ');
  const planner = new URLSearchParams({
    from: name(request.origin),
    to: name(request.destination),
    ship: plan.ship.name,
  });
  if (request.via?.length) planner.set('via', request.via.map(name).join(','));

  return (
    <div className={publicStyles.page}>
      <header className={publicStyles.bar}>
        <span className={publicStyles.brand} title="Darkbeacon">
          <LogoMark size={22} />
          <span className="sr-only">Darkbeacon</span>
        </span>
        <h1 className={publicStyles.name} title={stops.join(' > ')}>
          {stops.join(' > ')}
        </h1>
        <Badge variant="outline" icon={<Eye />}>
          Shared jump route
        </Badge>
      </header>
      <div className={styles.page}>
        <StarMap
          ref={mapRef}
          model={model}
          overlay={overlay}
          insets={phone ? { left: 0, bottom: 320 } : { left: 392, bottom: 0 }}
          onHover={() => {}}
          onPick={() => {}}
        />
        <aside className={styles.panel} data-open data-shared aria-label="Shared jump route">
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.title}>{plan.ship.name}</h2>
              <p className={styles.lede}>
                {formatRange(plan.rangeLy)} range · {skills}
              </p>
            </div>
          </div>
          <div className={styles.panelBody}>
            {route ? (
              <section className={styles.result} aria-label="Route">
                <div className={styles.totalsMain}>
                  {route.jumps} {route.jumps === 1 ? 'jump' : 'jumps'}
                  {route.gates > 0 && ` + ${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`}
                  {route.ansiblex > 0 && ` + ${route.ansiblex} Ansiblex`}
                  <span>{formatLy(route.ly)}</span>
                </div>
                <RouteSystems
                  route={route}
                  activeLeg={activeLeg}
                  setActiveLeg={setActiveLeg}
                  onShowLeg={(n) => {
                    const leg = legs[n];
                    if (leg) mapRef.current?.fit([leg.from, leg.to]);
                  }}
                />
                <RouteSummary plan={plan} fuelPrices={view.fuelPrices} />
              </section>
            ) : (
              <p className={styles.hint}>{plan.problem?.message ?? 'No route any more.'}</p>
            )}
            <Button asChild icon={<Route />}>
              <a href={`/jump?${planner}`}>Open in the planner</a>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
