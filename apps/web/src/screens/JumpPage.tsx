'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fatigueMinutesLeft,
  jumpRouteKey,
  routes,
  standingTone,
  type JumpMetaDto,
  type JumpFuelPricesDto,
  type JumpPlanDto,
  type JumpRouteDto,
  type JumpPlanRequest,
  type JumpShareCreatedDto,
  type JumpShareRequest,
  type JumpUniverseDto,
  type MapIntelDto,
} from '@darkbeacon/shared';
import { api } from '../lib/api';
import { useMyTracking } from '../lib/characters';
import { useMe } from '../lib/session';
import { usePageView } from '../lib/useTelemetry';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import { ErrorState } from '../ui';
import type { Overlay, RouteLeg } from '../jump/draw';
import { endpointsReducer } from '../jump/endpoints';
import { FreightPanel, JumpPanel, RouteChoices, type ForeignSpace } from '../jump/JumpPanel';
import { holderStanding, useStandings } from '../lib/intel';
import { SystemCard } from '../jump/SystemCard';
import { buildStarModel, distanceLy, isHighSec, noCynoReason, type StarModel } from '../jump/model';
import { useFatigueClock, useJumpPilot } from '../jump/pilot';
import { loadSettings, saveSettings, type PlannerSettings } from '../jump/settings';
import { useMapBridges } from '../jump/bridges';
import { StarMap, type StarMapHandle } from '../jump/StarMap';
import { pushRecent, suggestionsFor, type CharacterPlace, type SuggestionSources } from '../jump/suggest';
import styles from '../jump/jump.module.css';
import { JumpLoading } from './JumpLoading';
import type { PlannerMap } from './JumpPlannerClient';

/**
 * `/jump`: the jump planner. A map of all known space where a capital's jump route is planned
 * from A to B; the route comes from the server (`POST /api/jumps/plan`), the map data once per
 * dataset version (cached by the browser for good).
 */
export function JumpPage({ meta, chain = null }: { meta: JumpMetaDto; chain?: PlannerMap | null }) {
  useBreadcrumbs([{ label: 'Jump planner' }]);
  usePageView('jump');
  const universe = useQuery({
    queryKey: ['jumps', 'universe', meta.version],
    queryFn: () =>
      api<JumpUniverseDto>(`${routes.jumps.universe.path}?v=${encodeURIComponent(meta.version)}`),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const model = useMemo(() => (universe.data ? buildStarModel(universe.data) : null), [universe.data]);
  if (universe.isError)
    return (
      <div className={styles.page} data-immersive>
        <div className={styles.overlayCard}>
          <ErrorState
            title="The star map did not load"
            error={universe.error}
            onRetry={() => void universe.refetch()}
          />
        </div>
      </div>
    );
  if (!model) return <JumpLoading />;
  return <Planner meta={meta} model={model} chain={chain} />;
}

const PLAN_STALE = 5 * 60_000;

const planKey = (request: JumpPlanRequest | null) => ['jumps', 'plan', request] as const;

function fetchPlan(request: JumpPlanRequest, signal: AbortSignal): Promise<JumpPlanDto> {
  return api<JumpPlanDto>(routes.jumps.plan.path, { method: 'POST', json: request, signal });
}

/** The systems of a route in order: where it starts, then where each leg ends. */
function routeSystems(legs: readonly RouteLeg[]): number[] {
  return [legs[0]!.from, ...legs.map((l) => l.to)];
}

interface Pinned {
  system: number;
  at: { x: number; y: number };
}

/** Below the shell's phone breakpoint the controls become a bottom sheet. */
const PHONE = '(max-width: 767px)';

function readQuery(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function Planner({ meta, model, chain }: { meta: JumpMetaDto; model: StarModel; chain: PlannerMap | null }) {
  const mapRef = useRef<StarMapHandle>(null);
  const indexByName = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < model.size; i++) map.set(model.keys[i]!, i);
    return map;
  }, [model]);
  const regionByName = useMemo(
    () => new Map(model.regionNames.map((name, i) => [name.toLowerCase(), i])),
    [model],
  );
  const find = (name: string | null) => (name ? (indexByName.get(name.toLowerCase()) ?? null) : null);

  // The planner renders in the browser only, so remembered settings and the address
  // (?from=&to=&ship=) are read straight away.
  const [settings, setSettings] = useState<PlannerSettings>(() => {
    const stored = loadSettings();
    const ship = readQuery().get('ship');
    return ship ? { ...stored, ship } : stored;
  });
  // Start and destination change in one step (a reorder is never seen half done).
  const [ends, dispatch] = useReducer(endpointsReducer, null, () => ({
    origin: find(readQuery().get('from')),
    destination: find(readQuery().get('to')),
  }));
  const { origin, destination } = ends;
  // Stops on the way, in order; an empty picker (null) until a system is chosen for it.
  const [stops, setStops] = useState<Array<number | null>>(() =>
    (readQuery().get('via') ?? '')
      .split(',')
      .map((name) => find(name.trim()))
      .filter((i): i is number => i !== null),
  );
  const via = useMemo(() => stops.filter((i): i is number => i !== null), [stops]);
  // A trip through stops may end where it started (C-J6MT > Amamake > C-J6MT): then the ends may
  // be one system; without a stop, picking the other end's system swaps them as before.
  const looping = stops.some((s) => s !== null);
  // The destination emptied by "Add stop" is no reason to move the view (see the effect below).
  const addingStop = useRef(false);
  // "Add stop" adds the next destination at the bottom: the destination so far becomes the last
  // stop, and an empty destination waits to be picked.
  const addStop = () => {
    if (destination === null) {
      document.querySelector<HTMLInputElement>('[data-picker="destination"] input')?.focus();
      return;
    }
    setStops((s) => [...s, destination]);
    addingStop.current = true;
    dispatch({ type: 'set', origin, destination: null });
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('[data-picker="destination"] input')?.focus(),
    );
  };
  const removeStop = (n: number) => setStops((s) => s.filter((_, k) => k !== n));
  // A system picked for either end is remembered as a recent pick (reorders and the address are not).
  const remember = useCallback(
    (system: number | null) => {
      if (system === null) return;
      const name = model.names[system]!;
      setSettings((s) => (s.recent[0] === name ? s : { ...s, recent: pushRecent(s.recent, name) }));
    },
    [model],
  );
  const setOrigin = useCallback(
    (system: number | null) => {
      if (looping && system !== null && system === destination)
        dispatch({ type: 'set', origin: system, destination });
      else dispatch({ type: 'origin', system });
      remember(system);
    },
    [remember, looping, destination],
  );
  const pickDestination = (system: number | null) => {
    if (looping && system !== null && system === origin)
      dispatch({ type: 'set', origin, destination: system });
    else dispatch({ type: 'destination', system });
    remember(system);
  };
  const [hover, setHover] = useState<Pinned | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);
  // Phones start with the sheet folded, so the map shows first.
  const [panelOpen, setPanelOpen] = useState(() => !(window.matchMedia?.(PHONE).matches ?? false));
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(PHONE);
    if (!media) return;
    const update = () => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);

  const ship =
    meta.ships.find((s) => s.name === settings.ship) ??
    meta.ships.find((s) => s.name === 'Ark') ??
    meta.ships[0]!;

  useEffect(() => {
    const query = new URLSearchParams();
    const set = (key: string, value: string | null) => (value ? query.set(key, value) : query.delete(key));
    set('from', origin === null ? null : model.names[origin]!);
    set('to', destination === null ? null : model.names[destination]!);
    set('via', via.length > 0 ? via.map((i) => model.names[i]!).join(',') : null);
    set('ship', ship.name);
    const search = query.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}`,
    );
  }, [origin, destination, via, ship.name, model]);

  const avoidSystems = useMemo(
    () => new Set(settings.avoidSystems.flatMap((name) => find(name) ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find reads indexByName
    [settings.avoidSystems, indexByName],
  );
  const avoidRegions = useMemo(
    () => settings.avoidRegions.flatMap((name) => regionByName.get(name.toLowerCase()) ?? []),
    [settings.avoidRegions, regionByName],
  );
  const exits = useMemo(
    () => (chain?.exits ?? []).flatMap((id) => model.indexById.get(id) ?? []),
    [chain, model],
  );

  // What the pickers offer before anything is typed: where my characters are, the map's exits
  // and known-space systems, and what was picked here before.
  const me = useMe();
  const tracking = useMyTracking();
  const characters = useMemo((): CharacterPlace[] => {
    const names = new Map((me.data?.characters ?? []).map((c) => [c.id, c.name]));
    return (tracking.data?.characters ?? []).flatMap((c) => {
      const system = c.solarSystemId === null ? undefined : model.indexById.get(c.solarSystemId);
      const name = names.get(c.characterId);
      return system === undefined || name === undefined ? [] : [{ system, name, online: c.online === true }];
    });
  }, [me.data, tracking.data, model]);
  const mapSystems = useMemo(
    () => (chain?.systems ?? []).flatMap((id) => model.indexById.get(id) ?? []),
    [chain, model],
  );
  const recent = useMemo(
    () => settings.recent.flatMap((name) => find(name) ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find reads indexByName
    [settings.recent, indexByName],
  );
  const suggestions = useMemo(() => {
    const sources: SuggestionSources = { characters, exits, mapSystems, recent };
    return {
      origin: suggestionsFor('origin', sources, looping ? null : destination),
      destination: suggestionsFor('destination', sources, looping ? null : origin),
    };
  }, [characters, exits, mapSystems, recent, origin, destination, looping]);
  // Skills set by hand win over ESI's until ESI is asked again or the pilot changes (a training
  // level can be planned ahead); ESI's fatigue wins until edited, and counts down while open.
  const fill = useJumpPilot(settings.pilot);
  const fatigueClock = useFatigueClock(
    fill.fatigueExpiresAt !== undefined && fill.fatigueExpiresAt !== null,
    fill.answeredAt,
  );
  const skills = settings.skillsByHand ? settings.skills : (fill.skills ?? settings.skills);
  const fatigueNow =
    fill.fatigueExpiresAt === undefined
      ? settings.fatigueNow
      : fatigueMinutesLeft(fill.fatigueExpiresAt, fatigueClock);
  const shown = useMemo(() => ({ ...settings, skills, fatigueNow }), [settings, skills, fatigueNow]);

  // Ansiblex bridges come from the maps I can see (their routing settings), for ships that use them.
  const ansiblex = useMapBridges(ship.ansiblex);

  const requestFor = (
    from: number | null,
    to: number | null,
    stopsOn: readonly number[],
  ): JumpPlanRequest | null =>
    from !== null && to !== null && (from !== to || stopsOn.length > 0)
      ? {
          shipTypeId: ship.typeId,
          origin: model.ids[from]!,
          destination: model.ids[to]!,
          via: stopsOn.map((i) => model.ids[i]!),
          skills,
          avoidSystems: [...avoidSystems].map((i) => model.ids[i]!),
          avoidRegions: avoidRegions.map((r) => model.regionIds[r]!),
          preferStations: settings.preferStations,
          // Stargates only where a cyno cannot be lit: into high-sec, after the last jump.
          gates: [from, ...stopsOn, to].some((i) => isHighSec(model, i)) ? 'finish' : 'never',
          outlaw: settings.outlaw,
          ansiblex: ship.ansiblex ? ansiblex : [],
          maxFatigueMinutes: settings.maxFatigue,
          fatigueNowMinutes: fatigueNow,
          bridgeTonnes: ship.bridges ? settings.bridgeTonnes : null,
        }
      : null;
  const request = requestFor(origin, destination, via);
  const plan = useQuery({
    queryKey: planKey(request),
    queryFn: ({ signal }) => fetchPlan(request!, signal),
    enabled: request !== null,
    staleTime: PLAN_STALE,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const answer = request !== null ? (plan.data ?? null) : null;
  // What the isotopes cost at the pilot's hub: read when a route is shown, kept for a while.
  const fuelPrices = useQuery({
    queryKey: ['jumps', 'fuel-prices', settings.fuelHub],
    queryFn: ({ signal }) =>
      api<JumpFuelPricesDto>(`${routes.jumps.fuelPrices.path}?hub=${settings.fuelHub}`, { signal }),
    enabled: answer?.route != null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // The recommended route, or the alternative the pilot picked for this answer (a new answer
  // starts on the recommended one again, as a maps app does).
  const [choice, setChoice] = useState<{ of: JumpPlanDto | null; index: number }>({ of: null, index: 0 });
  const routeOptions = useMemo(
    () => (answer?.route ? [answer.route, ...(answer.alternatives ?? [])] : []),
    [answer],
  );
  const chosen = choice.of === answer && choice.index < routeOptions.length ? choice.index : 0;
  const result: JumpPlanDto | null = useMemo(
    () => (answer && routeOptions.length > 0 ? { ...answer, route: routeOptions[chosen]! } : answer),
    [answer, routeOptions, chosen],
  );
  const chooseRoute = (index: number) => {
    setChoice({ of: answer, index });
    setActiveLeg(null);
  };
  // Who holds the systems the route reaches; those neither mine nor blue are marked on their cards.
  const reached = useMemo(
    () => [...new Set((result?.route?.legs ?? []).map((l) => l.to.id))].sort((a, b) => a - b),
    [result],
  );
  const standings = useStandings();
  const routeIntel = useQuery({
    queryKey: ['intel', 'systems', reached.join(',')],
    queryFn: ({ signal }) =>
      api<MapIntelDto>(`${routes.intel.systems.path}?ids=${reached.join(',')}`, { signal }),
    enabled: reached.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const heldBy = useMemo(() => {
    const foreign = new Map<number, ForeignSpace>();
    for (const intel of routeIntel.data?.systems ?? []) {
      const sov = intel.sovereignty;
      if (sov?.kind !== 'alliance') continue;
      const standing = holderStanding(intel, standings);
      if (standing !== null && standing > 0) continue;
      foreign.set(intel.solarSystemId, {
        holder: sov.holder.ticker ?? sov.holder.name ?? 'Unknown alliance',
        tone: standingTone(standing),
      });
    }
    return foreign;
  }, [routeIntel.data, standings]);
  const toLegs = useCallback(
    (route: JumpRouteDto): RouteLeg[] =>
      route.legs.map((leg) => ({
        from: model.indexById.get(leg.from.id)!,
        to: model.indexById.get(leg.to.id)!,
        kind: leg.kind,
      })),
    [model],
  );
  const legs: RouteLeg[] | null = useMemo(
    () => (result?.route ? toLegs(result.route) : null),
    [result, toLegs],
  );
  // The other routes, drawn faintly; a click on one picks it (by its place among the options).
  const others = useMemo(
    () => routeOptions.map((_, n) => n).filter((n) => n !== chosen),
    [routeOptions, chosen],
  );
  const otherLegs = useMemo(
    () => others.map((n) => toLegs(routeOptions[n]!)),
    [others, routeOptions, toLegs],
  );

  const rangeLy = ship.rangeLy * (1 + meta.rangeBonusPerLevel * skills.jdc);
  const focusLeg = activeLeg !== null && legs?.[activeLeg]?.kind === 'jump' ? legs[activeLeg]! : null;
  // The range around the start until there is a route, then around the leg under the pointer.
  const rangeFrom = focusLeg ? focusLeg.from : legs ? null : origin;
  const reachable = useMemo(() => {
    if (rangeFrom === null) return null;
    const out = new Uint8Array(model.size);
    for (let i = 0; i < model.size; i++)
      if (i !== rangeFrom && noCynoReason(model, i) === null && distanceLy(model, rangeFrom, i) <= rangeLy)
        out[i] = 1;
    return out;
  }, [model, rangeFrom, rangeLy]);

  const overlay: Overlay = useMemo(
    () => ({
      origin,
      destination,
      hover: pinned?.system ?? hover?.system ?? null,
      rangeFrom,
      rangeLy,
      reachable,
      route: legs,
      alternatives: otherLegs,
      activeLeg,
      avoided: avoidSystems,
      exits: new Set(exits),
    }),
    [
      origin,
      destination,
      pinned,
      hover,
      rangeFrom,
      rangeLy,
      reachable,
      legs,
      otherLegs,
      activeLeg,
      avoidSystems,
      exits,
    ],
  );

  // Bring what matters into view: the whole route once it arrives, else the start and its range.
  // Keyed by the route's systems in any order, so the reverse route (a reorder) leaves the view be.
  const routeKey = legs?.length
    ? routeSystems(legs)
        .sort((a, b) => a - b)
        .join(',')
    : null;
  useEffect(() => {
    if (!legs || legs.length === 0) return;
    mapRef.current?.fit(routeSystems(legs));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the route's systems
  }, [routeKey]);
  const lastEnds = useRef(ends);
  useEffect(() => {
    const before = lastEnds.current;
    lastEnds.current = ends;
    // A destination that became the start (a reorder) is where the view already is.
    const added = addingStop.current;
    addingStop.current = false;
    if (added || ends.origin === null || ends.destination !== null || ends.origin === before.destination)
      return;
    mapRef.current?.centre(ends.origin);
  }, [ends]);

  const { edited } = fill;
  const update = useCallback(
    (change: Partial<PlannerSettings>) => {
      if (change.fatigueNow !== undefined) edited('fatigue');
      setSettings((s) => ({ ...s, ...change }));
    },
    [edited],
  );
  const toggleAvoid = (i: number) => {
    const name = model.names[i]!;
    update({
      avoidSystems: avoidSystems.has(i)
        ? settings.avoidSystems.filter((n) => n.toLowerCase() !== name.toLowerCase())
        : [...settings.avoidSystems, name],
    });
  };

  // Keyboard: `/` searches (the first empty of start and destination), Esc clears.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPanelOpen(true);
        requestAnimationFrame(() => {
          const which = origin === null ? 'origin' : 'destination';
          panelRef.current?.querySelector<HTMLInputElement>(`[data-picker="${which}"] input`)?.focus();
        });
      } else if (e.key === 'Escape') {
        if (typing) {
          (typing as HTMLElement).blur();
          return;
        }
        if (document.querySelector('[role="menu"], [role="listbox"]')) return;
        if (pinned) setPinned(null);
        else {
          dispatch({ type: 'clear' });
          setStops([]);
          setActiveLeg(null);
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [origin, pinned]);

  // Room the controls take: the docked panel on the left, or the sheet's peek on phones.
  // A jump freighter's route gets its freight quote as a folded card at the map's top right.
  const freight = !phone && ship.hull === 'jump_freighter' && result?.route != null;
  const insets = phone ? { left: 0, bottom: 140 } : { left: 392, right: 0, bottom: 0 };
  const card = pinned ?? hover;

  return (
    <div className={styles.page} data-immersive>
      <StarMap
        ref={mapRef}
        model={model}
        overlay={overlay}
        insets={insets}
        onHover={(system, at) => setHover(system === null || at === null ? null : { system, at })}
        onPick={(system, at) => setPinned(system === null ? null : { system, at })}
        onPickAlternative={(k) => {
          const n = others[k];
          if (n !== undefined) chooseRoute(n);
        }}
      />
      {card && (
        <SystemCard
          model={model}
          system={card.system}
          at={card.at}
          pinned={pinned !== null}
          origin={origin}
          rangeLy={rangeLy}
          avoided={avoidSystems.has(card.system)}
          chainName={exits.includes(card.system) ? (chain?.map ?? null) : null}
          onClose={() => setPinned(null)}
          onOrigin={() => {
            setOrigin(card.system);
            setPinned(null);
          }}
          onDestination={() => {
            pickDestination(card.system);
            setPinned(null);
          }}
          onAvoid={() => {
            toggleAvoid(card.system);
            setPinned(null);
          }}
        />
      )}
      <JumpPanel
        ref={panelRef}
        meta={meta}
        model={model}
        ship={ship}
        settings={shown}
        update={update}
        pilot={fill}
        origin={origin}
        destination={destination}
        setOrigin={setOrigin}
        setDestination={(i) => {
          pickDestination(i);
          // On phones the answer is the map: fold the sheet once a destination is picked for a
          // start (a reorder keeps it open: the pilot is still at the controls).
          if (phone && i !== null && origin !== null && origin !== i) setPanelOpen(false);
        }}
        stops={stops}
        setStop={(n, system) => {
          setStops((s) => s.map((x, k) => (k === n ? system : x)));
          remember(system);
        }}
        addStop={addStop}
        movePoint={(from, to) => {
          const points = [origin, ...stops, destination];
          const [moved] = points.splice(from, 1);
          points.splice(to, 0, moved ?? null);
          dispatch({
            type: 'set',
            origin: points[0] ?? null,
            destination: points[points.length - 1] ?? null,
          });
          setStops(points.slice(1, -1));
          setActiveLeg(null);
        }}
        removeStop={removeStop}
        fuelPrices={fuelPrices.data ?? null}
        onShare={async (freight) => {
          if (!request) throw new Error('No route to share');
          const { token } = await api<JumpShareCreatedDto>(routes.jumps.share.path, {
            method: 'POST',
            json: {
              plan: request,
              fuelHub: settings.fuelHub,
              // The route on screen (an alternative if one was picked), as a pilot or a client.
              route: result?.route ? jumpRouteKey(result.route) : null,
              freight: freight ?? null,
            } satisfies JumpShareRequest,
          });
          return `${window.location.origin}/j/${token}`;
        }}
        suggestions={suggestions}
        avoidSystems={avoidSystems}
        avoidRegions={avoidRegions}
        ansiblexCount={ansiblex.length}
        heldBy={heldBy}
        rangeLy={rangeLy}
        plan={result}
        routeOptions={routeOptions}
        chosenRoute={chosen}
        onChooseRoute={chooseRoute}
        planning={plan.isFetching}
        planError={plan.error}
        activeLeg={activeLeg}
        setActiveLeg={setActiveLeg}
        onShowLeg={(n) => {
          const leg = legs?.[n];
          if (leg) mapRef.current?.fit([leg.from, leg.to]);
        }}
        open={panelOpen}
        setOpen={setPanelOpen}
        phone={phone}
      />
      {freight && (
        <FreightPanel plan={result} settings={shown} update={update} fuelPrices={fuelPrices.data ?? null} />
      )}
      {!phone && (
        <div className={styles.choicesDock} style={{ left: insets.left, right: insets.right || 56 }}>
          <RouteChoices
            floating
            routeOptions={routeOptions}
            chosenRoute={chosen}
            onChooseRoute={chooseRoute}
            plan={result}
            fuelPrices={fuelPrices.data ?? null}
          />
        </div>
      )}
    </div>
  );
}
