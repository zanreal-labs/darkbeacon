'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Route, UserRound } from 'lucide-react';
import {
  routes,
  type JumpShareFreight,
  type JumpShareViewDto,
  type JumpUniverseDto,
} from '@darkbeacon/shared';
import { api } from '../lib/api';
import { LogoMark } from '../shell/Logo';
import { Badge, Button, Disclosure, ErrorState, FieldGroup } from '../ui';
import type { Overlay, RouteLeg } from './draw';
import { formatIsk, formatNumber, formatRange } from './format';
import { RouteChoices, RouteSystems } from './JumpPanel';
import { buildStarModel, type StarModel } from './model';
import { StarMap, type StarMapHandle } from './StarMap';
import { JumpLoading } from '../screens/JumpLoading';
import publicStyles from '../screens/PublicMap.module.css';
import styles from './jump.module.css';

const PHONE = '(max-width: 767px)';
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

/**
 * A shared jump route, read-only, laid out as the planner is: the route's systems as cards beside
 * the map, its totals in a bubble over it. For pilots, as the sharer planned it (ship, stops,
 * levels); for a client's freight quote, the route and the price only, no fuel or skills.
 * Anyone with the link sees it; nothing here edits, and nothing about the sharer is shown.
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
  const planner = new URLSearchParams({
    from: name(request.origin),
    to: name(request.destination),
    ship: plan.ship.name,
  });
  if (request.via?.length) planner.set('via', request.via.map(name).join(','));
  const freight = view.freight;
  const showLeg = (n: number) => {
    const leg = legs[n];
    if (leg) mapRef.current?.fit([leg.from, leg.to]);
  };
  // What the bubble over the map says: the client's price, or the route's totals for pilots.
  const totals = freight ? (
    route ? (
      <FreightTotals freight={freight} jumps={route.jumps} gates={route.gates} />
    ) : null
  ) : (
    <RouteChoices
      floating
      routeOptions={route ? [route] : []}
      chosenRoute={0}
      onChooseRoute={() => {}}
      plan={plan}
      fuelPrices={view.fuelPrices}
    />
  );

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
          {freight ? 'Freight quote' : 'Shared jump route'}
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
        <aside
          className={styles.panel}
          data-open
          data-shared
          aria-label={freight ? 'Freight quote' : 'Shared jump route'}
        >
          <div className={styles.panelHead}>
            <h2 className={styles.title}>{freight ? 'Freight quote' : plan.ship.name}</h2>
            {!freight && (
              <Button asChild size="sm" icon={<Route />}>
                <a href={`/jump?${planner}`}>Open in planner</a>
              </Button>
            )}
          </div>
          <div className={styles.panelBody}>
            {/* On a phone the bubble's numbers lead the sheet. */}
            {phone && totals}
            {route ? (
              <FieldGroup label="Route" className={styles.routeGroup}>
                <section aria-label="Route">
                  <RouteSystems
                    route={route}
                    activeLeg={activeLeg}
                    setActiveLeg={setActiveLeg}
                    onShowLeg={showLeg}
                    brief={freight !== null}
                  />
                </section>
              </FieldGroup>
            ) : (
              <p className={styles.hint}>{plan.problem?.message ?? 'No route any more.'}</p>
            )}
            {/* The levels the pilot planned with: for pilots, never for a client. */}
            {!freight && (
              <div className={styles.settingsFoot}>
                <Disclosure icon={<UserRound aria-hidden />} title="Pilot">
                  <dl className={styles.facts}>
                    <div>
                      <dt>Range</dt>
                      <dd>{formatRange(plan.rangeLy)}</dd>
                    </div>
                    <div>
                      <dt>Calibration</dt>
                      <dd>{ROMAN[request.skills?.jdc ?? 5]}</dd>
                    </div>
                    <div>
                      <dt>Conservation</dt>
                      <dd>{ROMAN[request.skills?.jfc ?? 4]}</dd>
                    </div>
                    {plan.ship.hull === 'jump_freighter' && (
                      <div>
                        <dt>Freighters</dt>
                        <dd>{ROMAN[request.skills?.jf ?? 4]}</dd>
                      </div>
                    )}
                  </dl>
                </Disclosure>
              </div>
            )}
          </div>
        </aside>
        {!phone && (
          <div className={styles.choicesDock} style={{ left: 392, right: 56 }}>
            {totals}
          </div>
        )}
      </div>
    </div>
  );
}

/** A client's freight quote at a glance: what to pay, and what for. */
function FreightTotals({
  freight,
  jumps,
  gates,
}: {
  freight: JumpShareFreight;
  jumps: number;
  gates: number;
}) {
  return (
    <section className={styles.choicesBubble} aria-label="Price">
      <div className={styles.choice}>
        <span className={styles.choiceTitle}>Price</span>
        <span className={styles.choiceMain}>{formatIsk(freight.price)}</span>
        <dl className={styles.facts}>
          <div>
            <dt>Jumps</dt>
            <dd>
              {jumps}
              {gates > 0 && ` + ${gates} ${gates === 1 ? 'gate' : 'gates'}`}
            </dd>
          </div>
          {freight.cargoM3 !== null && (
            <div>
              <dt>Cargo</dt>
              <dd>{formatNumber(freight.cargoM3)} m³</dd>
            </div>
          )}
          {freight.collateral !== null && (
            <div>
              <dt>Collateral</dt>
              <dd>{formatIsk(freight.collateral)}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
