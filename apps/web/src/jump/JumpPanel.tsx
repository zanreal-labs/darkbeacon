'use client';

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Coins,
  GripVertical,
  Copy,
  Link2,
  Plus,
  Navigation,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import {
  buildPath,
  JUMP_HULLS,
  routes,
  type JumpFuelHub,
  type JumpFuelPricesDto,
  type JumpHull,
  type JumpLegDto,
  type JumpMetaDto,
  type JumpPlanDto,
  type JumpRouteBest,
  type JumpRouteDto,
  type JumpShareFreight,
  type StandingTone,
  type JumpShipDto,
  type OptionalEveScope,
  type WaypointRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { hereForReturn, relinkHref } from '../lib/scope-health';
import { useMe } from '../lib/session';
import {
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  Disclosure,
  Field,
  FieldGroup,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  SearchPicker,
  Select,
  Spinner,
  Switch,
  useToast,
  type PickerOption,
} from '../ui';
import {
  formatLy,
  formatMinutes,
  formatNumber,
  formatIsk,
  formatRange,
  HULL_LABELS,
  ISOTOPE_LABELS,
  routeText,
} from './format';
import { searchSystems, securityColor, securityLabel, type StarModel } from './model';
import type { PilotFill } from './pilot';
import type { PlannerSettings } from './settings';
import { rankSystems, whyLabel, type End, type Suggestion, type SuggestionWhy } from './suggest';
import { freightQuote, parseIsk, type FreightTerms } from './freight';
import styles from './jump.module.css';

interface SystemOption extends PickerOption {
  index: number;
}

const FATIGUE_CAPS = [
  { value: 'off', label: 'No limit' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
  { value: '240', label: '4 hours' },
];

const LEVELS = [0, 1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: ['0', 'I', 'II', 'III', 'IV', 'V'][n]!,
}));

export interface JumpPanelProps {
  meta: JumpMetaDto;
  model: StarModel;
  ship: JumpShipDto;
  /** The settings as the planner uses them: skills and fatigue from ESI where they win. */
  settings: PlannerSettings;
  update(change: Partial<PlannerSettings>): void;
  /** The pilot whose skills and fatigue ESI fills in. */
  pilot: PilotFill;
  origin: number | null;
  destination: number | null;
  setOrigin(i: number | null): void;
  setDestination(i: number | null): void;
  avoidSystems: ReadonlySet<number>;
  avoidRegions: readonly number[];
  rangeLy: number;
  /** The answer with `route` set to the route the pilot looks at. */
  plan: JumpPlanDto | null;
  /** Stops on the way, in order; null for a picker with no system yet. */
  stops: ReadonlyArray<number | null>;
  setStop(n: number, system: number | null): void;
  addStop(): void;
  removeStop(n: number): void;
  /** Moves a point of the trip (0 the start, then the stops, last the destination) to `to`. */
  movePoint(from: number, to: number): void;
  /** Isotope prices at the pilot's hub; null until they come (or when they cannot). */
  fuelPrices: JumpFuelPricesDto | null;
  /** Shares the route on screen as a link anyone can open; resolves to its address. */
  onShare(freight?: JumpShareFreight | null): Promise<string>;
  /** The recommended route first, then the alternatives; one route when there is no choice. */
  routeOptions: readonly JumpRouteDto[];
  chosenRoute: number;
  onChooseRoute(index: number): void;
  planning: boolean;
  planError: Error | null;
  activeLeg: number | null;
  setActiveLeg(n: number | null): void;
  onShowLeg(n: number): void;
  open: boolean;
  setOpen(open: boolean): void;
  phone: boolean;
  /** Systems on the route held by someone neither mine nor blue (by EVE id). */
  heldBy: ReadonlyMap<number, ForeignSpace>;
  /** What each picker offers on focus and ranks first while typing. */
  suggestions: Readonly<Record<End, readonly Suggestion[]>>;
  ref?: Ref<HTMLDivElement>;
}

type PanelState = Omit<JumpPanelProps, 'ref'>;

/** Who holds a system the route reaches, when that is neither my alliance nor blue. */
export interface ForeignSpace {
  holder: string;
  tone: StandingTone;
}

/** The planner's controls: ship, start and destination, skills, options, and the route found. */
export function JumpPanel({ ref, ...props }: JumpPanelProps) {
  const { model, ship, settings, update, origin, destination, plan, setOpen, phone } = props;
  // Folds away only as a sheet on a phone; beside the map it always shows.
  const open = phone ? props.open : true;
  // Start, stops and destination in one list, reordered by dragging a row's grip (mouse or touch)
  // or with the arrow keys on it, as a maps app does.
  const points = 2 + props.stops.length;
  const [drag, setDrag] = useState<Drag | null>(null);
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-point="${refocus.current}"] [data-grip]`)?.focus();
    refocus.current = null;
  });
  const grip = (n: number): GripHandlers => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      // No text selection while dragging; the grip keeps the pointer until it is let go.
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser does not track (synthetic): the move events still come here.
      }
      setDrag({ from: n, to: n });
    },
    onPointerMove: (e) => {
      if (!drag) return;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-point]');
      const to = row ? Number(row.getAttribute('data-point')) : null;
      if (to !== null && to !== drag.to) setDrag({ ...drag, to });
    },
    onPointerUp: () => {
      if (drag && drag.to !== drag.from) props.movePoint(drag.from, drag.to);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      const to = e.key === 'ArrowUp' ? n - 1 : e.key === 'ArrowDown' ? n + 1 : null;
      if (to === null || to < 0 || to >= points) return;
      e.preventDefault();
      refocus.current = to;
      props.movePoint(n, to);
    },
  });
  const option = (i: number, why: SuggestionWhy | null = null): SystemOption => {
    const region = model.regionNames[model.regionOf[i]!]!;
    return {
      key: String(model.ids[i]),
      index: i,
      label: model.names[i]!,
      leading: <SecPill security={model.security[i]!} />,
      detail: why ? `${region}, ${whyLabel(why)}` : region,
    };
  };
  // Suggestions and search share one list: the same rows, suggestions first.
  const searchFor = (end: End) => async (text: string) => ({
    options: rankSystems(model, text, props.suggestions[end]).map((r) => option(r.index, r.why)),
  });
  const suggestionsKey = (end: End) => props.suggestions[end].map(suggestionKey).join(',');
  const hulls = JUMP_HULLS.filter((h) => props.meta.ships.some((s) => s.hull === h));
  const shipsOfHull = props.meta.ships.filter((s) => s.hull === ship.hull);
  const route = plan?.route ?? null;

  // The legs between each two points of the trip (a leg ending at a stop closes one), when the
  // route on screen is the one for these points; else the points show alone.
  const points_ = [origin, ...props.stops, destination];
  const stopsInPlan = points_.slice(1);
  const segments = route ? segmentsOf(route, points_, model) : null;
  const legHover = {
    active: props.activeLeg,
    setActive: props.setActiveLeg,
    show: props.onShowLeg,
    held: props.heldBy,
  };
  const pointRow = (k: number, arrival?: { leg: JumpLegDto; n: number }) => {
    const last = k === points - 1;
    const stop = k > 0 && !last ? k - 1 : null;
    const value = points_[k] ?? null;
    const label = k === 0 ? 'Start' : last ? 'Destination' : `Stop ${k}`;
    return (
      <PointRow key={`p${k}`} n={k} label={label} drag={drag} grip={grip} arrival={arrival} {...legHover}>
        <SearchPicker<SystemOption>
          value={value === null ? null : option(value)}
          onChange={(o) => {
            const i = o?.index ?? null;
            if (k === 0) props.setOrigin(i);
            else if (last) props.setDestination(i);
            // Clearing a stop takes it off the trip, as a maps app does.
            else if (i === null) props.removeStop(stop!);
            else props.setStop(stop!, i);
          }}
          search={searchFor(k === 0 ? 'origin' : 'destination')}
          cacheKey={[
            'jump-systems',
            k === 0 ? 'origin' : last ? 'destination' : 'stop',
            suggestionsKey(k === 0 ? 'origin' : 'destination'),
          ]}
          minLength={0}
          debounce={0}
          placeholder={k === 0 ? 'Start ( / )' : label}
          bare
          clearLabel={stop !== null ? `Remove stop ${k}` : undefined}
          empty="No known-space system by that name"
          trailing={
            stop !== null ? (
              <IconButton
                size="sm"
                label={`Remove stop ${k}`}
                icon={<X />}
                tooltip={false}
                onClick={() => props.removeStop(stop)}
              />
            ) : undefined
          }
        />
      </PointRow>
    );
  };

  const summary =
    origin !== null && destination !== null
      ? `${model.names[origin]} to ${model.names[destination]}`
      : origin !== null
        ? `From ${model.names[origin]}`
        : 'Pick a start and a destination';

  return (
    <aside
      ref={ref}
      className={styles.panel}
      data-open={open || undefined}
      data-phone={phone || undefined}
      aria-label="Jump planner"
    >
      {phone ? (
        <button
          type="button"
          className={styles.sheetHandle}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.grabber} aria-hidden />
          <span className={styles.sheetTitle}>
            <strong>{ship.name}</strong>
            <span>
              {route
                ? `${route.jumps} ${route.jumps === 1 ? 'jump' : 'jumps'} · ${formatLy(route.ly)} · ${formatNumber(route.fuel)} fuel`
                : summary}
            </span>
          </span>
          {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
        </button>
      ) : (
        <div className={styles.panelHead}>
          <h1 className={styles.title}>Jump planner</h1>
          {plan && route && (
            <RouteActions plan={plan} onShare={props.onShare} freight={freightDefaults(props)} />
          )}
        </div>
      )}

      {open && (
        <div className={styles.panelBody}>
          <div className={styles.row2}>
            <Field label="Hull">
              <Select
                value={ship.hull}
                onValueChange={(hull) => {
                  const first = props.meta.ships.find((s) => s.hull === (hull as JumpHull));
                  if (first) update({ ship: first.name });
                }}
                options={hulls.map((h) => ({ value: h, label: HULL_LABELS[h] }))}
              />
            </Field>
            <Field label="Ship">
              <Select
                value={ship.name}
                onValueChange={(name) => update({ ship: name })}
                options={shipsOfHull.map((s) => ({ value: s.name, label: s.name }))}
              />
            </Field>
          </div>

          {/* The trip as a maps app shows it: the points set here, the systems between them. */}
          <FieldGroup label="Route" className={styles.routeGroup}>
            <div className={styles.endpoints}>
              {pointRow(0)}
              {stopsInPlan.map((_, k) => (
                <Fragment key={k}>
                  {(segments?.[k] ?? []).slice(0, -1).map(({ leg, n }) => (
                    <LegRow key={n} leg={leg} n={n} {...legHover} />
                  ))}
                  {pointRow(k + 1, segments?.[k]?.at(-1))}
                </Fragment>
              ))}
              {/* A stop goes before the destination, as a maps app adds it. */}
              {props.stops.length < 10 && (
                <button type="button" className={styles.addStop} onClick={props.addStop}>
                  <Plus aria-hidden />
                  Add stop
                </button>
              )}
            </div>
          </FieldGroup>
          <Result {...props} />

          <div className={styles.settingsFoot}>
            <Disclosure
              icon={<SlidersHorizontal aria-hidden />}
              title="Route options"
              summary={optionsSummary(settings, props)}
            >
              <Options {...props} />
            </Disclosure>
            <PilotSkills {...props} />
          </div>
        </div>
      )}
    </aside>
  );
}

interface Drag {
  from: number;
  to: number;
}

interface GripHandlers {
  onPointerDown(e: PointerEvent<HTMLButtonElement>): void;
  onPointerMove(e: PointerEvent<HTMLButtonElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

interface LegHover {
  active: number | null;
  setActive(n: number | null): void;
  show(n: number): void;
  /** Systems held by someone neither mine nor blue. */
  held?: ReadonlyMap<number, ForeignSpace>;
  /** Only the distance under each system (a client's freight quote shows no fuel or fatigue). */
  brief?: boolean;
}

/**
 * One point of the trip: its picker as wide as the panel, a grip in the margin to reorder it,
 * and under it how the route arrives there (the leg that ends at it).
 */
function PointRow({
  n,
  label,
  drag,
  grip,
  arrival,
  active,
  setActive,
  show,
  held,
  children,
}: {
  n: number;
  label: string;
  drag: Drag | null;
  grip(n: number): GripHandlers;
  arrival?: { leg: JumpLegDto; n: number };
  children: ReactNode;
} & LegHover) {
  const target =
    drag && drag.from !== n && drag.to === n ? (drag.to < drag.from ? 'before' : 'after') : undefined;
  return (
    <div
      className={styles.point}
      data-picker={label === 'Start' ? 'origin' : label === 'Destination' ? 'destination' : 'stop'}
      data-point={n}
      data-drop={target}
      data-dragging={drag?.from === n || undefined}
    >
      <button
        type="button"
        data-grip
        className={styles.grip}
        aria-label={`Move ${label.toLowerCase()} (drag, or arrow keys)`}
        title="Drag to reorder"
        {...grip(n)}
      >
        <GripVertical aria-hidden />
      </button>
      <div
        className={styles.systemCard}
        data-leg={arrival?.n}
        data-active={(arrival && active === arrival.n) || undefined}
        onMouseEnter={arrival ? () => setActive(arrival.n) : undefined}
        onMouseLeave={arrival ? () => setActive(null) : undefined}
      >
        <Field label={label} hideLabel>
          {children}
        </Field>
        {arrival?.leg.kind === 'jump' && (
          <LegStats leg={arrival.leg} held={held?.get(arrival.leg.to.id)} onShow={() => show(arrival.n)} />
        )}
      </div>
    </div>
  );
}

/** A system's security in the map's colours, as the chain shows it. */
function SecPill({ security }: { security: number }) {
  return (
    <span className={styles.secPill} style={{ background: securityColor(security) }}>
      {securityLabel(security)}
    </span>
  );
}

/** How a jump gets to a system: distance, fuel, fatigue (and the wait before it, if any). */
function LegStats({
  leg,
  held,
  brief,
  onShow,
}: {
  leg: JumpLegDto;
  held?: ForeignSpace;
  brief?: boolean;
  onShow(): void;
}) {
  const facts: Array<[string, string, StandingTone?]> = brief
    ? [['Distance', formatLy(leg.ly)]]
    : [
        ['Distance', formatLy(leg.ly)],
        ['Fuel', formatNumber(leg.fuel + (leg.bridgeFuel ?? 0))],
        ['Fatigue', formatMinutes(leg.fatigueMinutes)],
        ...(leg.waitMinutes > 0
          ? ([['Wait', formatMinutes(leg.waitMinutes)]] as Array<[string, string]>)
          : []),
        // Landing in space that is neither mine nor blue: who holds it, in its standing colour.
        ...(held ? ([['Held by', held.holder, held.tone]] as Array<[string, string, StandingTone]>) : []),
      ];
  return (
    <button type="button" className={styles.legStats} onClick={onShow} aria-label="Show this jump on the map">
      <dl className={styles.facts}>
        {facts.map(([term, value, tone]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd data-tone={tone}>{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}

/** A system the route passes between two points: a card with its name and how the route gets there. */
function LegRow({ leg, n, active, setActive, show, held, brief }: { leg: JumpLegDto; n: number } & LegHover) {
  return (
    <div
      className={styles.systemCard}
      data-kind={leg.kind}
      data-leg={n}
      data-active={active === n || undefined}
      onMouseEnter={() => setActive(n)}
      onMouseLeave={() => setActive(null)}
    >
      <div className={styles.systemName}>
        <SecPill security={leg.to.security} />
        <strong>{leg.to.name}</strong>
        <span className={styles.systemRegion}>{leg.to.region}</span>
        {leg.kind !== 'jump' && <em>{leg.kind === 'gate' ? 'gate' : 'Ansiblex'}</em>}
        {leg.kind === 'jump' && !leg.to.station && !leg.stop && !brief && <em>no station</em>}
        {leg.stop && <em>stop</em>}
      </div>
      {leg.kind === 'jump' && (
        <LegStats leg={leg} held={held?.get(leg.to.id)} brief={brief} onShow={() => show(n)} />
      )}
    </div>
  );
}

/** A route read only (a shared link): its start, then every system it reaches, as cards. */
export function RouteSystems({
  route,
  activeLeg,
  setActiveLeg,
  onShowLeg,
  brief = false,
}: {
  route: JumpRouteDto;
  activeLeg: number | null;
  setActiveLeg(n: number | null): void;
  onShowLeg(n: number): void;
  /** Distances only, no fuel or fatigue (a client's freight quote). */
  brief?: boolean;
}) {
  const start = route.legs[0]?.from;
  if (!start) return null;
  const hover = { active: activeLeg, setActive: setActiveLeg, show: onShowLeg, brief };
  return (
    <div className={styles.endpoints}>
      <div className={styles.systemCard}>
        <div className={styles.systemName}>
          <SecPill security={start.security} />
          <strong>{start.name}</strong>
          <span className={styles.systemRegion}>{start.region}</span>
        </div>
      </div>
      {route.legs.map((leg, n) => (
        <LegRow key={n} leg={leg} n={n} {...hover} />
      ))}
    </div>
  );
}

/**
 * The route's legs cut at the points of the trip (start, stops, destination), or null when the
 * route on screen is not for these points (still planning, or a stop without a system yet).
 */
function segmentsOf(
  route: JumpRouteDto,
  points: ReadonlyArray<number | null>,
  model: StarModel,
): Array<Array<{ leg: JumpLegDto; n: number }>> | null {
  if (points.some((p) => p === null) || route.legs.length === 0) return null;
  const ids = points.map((p) => model.ids[p!]!);
  if (route.legs[0]!.from.id !== ids[0]) return null;
  const segments: Array<Array<{ leg: JumpLegDto; n: number }>> = [[]];
  route.legs.forEach((leg, n) => {
    segments.at(-1)!.push({ leg, n });
    if (leg.stop && n < route.legs.length - 1) segments.push([]);
  });
  if (segments.length !== ids.length - 1) return null;
  for (let k = 0; k < segments.length; k++) if (segments[k]!.at(-1)!.leg.to.id !== ids[k + 1]) return null;
  return segments;
}

/** Identifies a suggestion and what its row says, for the picker's cache. */
function suggestionKey(s: Suggestion): string {
  const why = s.why;
  return why.kind === 'character'
    ? `${s.index}:c${why.online ? 1 : 0}${why.names.join('|')}`
    : `${s.index}:${why.kind}`;
}

function optionsSummary(settings: PlannerSettings, props: PanelState): string {
  const parts: string[] = [];
  if (!settings.preferStations) parts.push('any landing');
  if (settings.outlaw) parts.push('outlaw');
  if (settings.fatigueNow > 0) parts.push(`fatigue now ${formatMinutes(settings.fatigueNow)}`);
  if (settings.maxFatigue !== null) parts.push(`fatigue ≤ ${formatMinutes(settings.maxFatigue)}`);
  const avoided = props.avoidSystems.size + props.avoidRegions.length;
  if (avoided > 0) parts.push(`${avoided} avoided`);
  if (props.ship.ansiblex && settings.ansiblex) parts.push('Ansiblex');
  return parts.join(' · ');
}

interface AvoidOption extends PickerOption {
  kind: 'system' | 'region';
  name: string;
}

/**
 * The pilot's skills, folded away: they change rarely and ESI fills them in. The summary says
 * where the levels come from, and warns when they are only assumed (fuel and range follow them).
 */
function PilotSkills(props: PanelState) {
  const { pilot: fill, settings, update, ship } = props;
  const { skills } = settings;
  // Picked by hand wins over ESI until ESI is asked again or the pilot changes.
  const byHand = settings.skillsByHand;
  const fromEsi = !byHand && fill.skills !== null && fill.pilot !== null;
  return (
    // Folded, it says only that the levels are guessed; open, what they are and where they come from.
    <Disclosure
      icon={!fromEsi && !byHand ? <TriangleAlert aria-hidden /> : <UserRound aria-hidden />}
      title="Skills"
      warn={!fromEsi && !byHand}
    >
      <Pilot {...props} />
      <div className={styles.skills}>
        <Field label="Calibration">
          <Select
            size="sm"
            value={String(skills.jdc)}
            onValueChange={(v) => update({ skills: { ...skills, jdc: Number(v) }, skillsByHand: true })}
            options={LEVELS}
          />
        </Field>
        <Field label="Conservation">
          <Select
            size="sm"
            value={String(skills.jfc)}
            onValueChange={(v) => update({ skills: { ...skills, jfc: Number(v) }, skillsByHand: true })}
            options={LEVELS}
          />
        </Field>
        {ship.hull === 'jump_freighter' && (
          <Field label="Freighters">
            <Select
              size="sm"
              value={String(skills.jf)}
              onValueChange={(v) => update({ skills: { ...skills, jf: Number(v) }, skillsByHand: true })}
              options={LEVELS}
            />
          </Field>
        )}
      </div>
      {/* The range they give and where they come from, then what to do when EVE could fill them. */}
      <p className={styles.skillsHint}>
        {formatRange(props.rangeLy)} range ·{' '}
        {fromEsi
          ? `From ESI · ${fill.pilot!.name}`
          : byHand
            ? 'Set by hand · refresh to read ESI again'
            : 'Assumed, not read from EVE'}
      </p>
      <PilotHint {...props} />
    </Disclosure>
  );
}

/** Whose skills and fatigue ESI fills in, and a way to read them again. */
function Pilot({ pilot: fill, update }: PanelState) {
  const { pilot, characters } = fill;
  if (!pilot) return null;
  return (
    <div className={styles.pilot}>
      <Field label="Pilot">
        <Select
          size="sm"
          value={String(pilot.id)}
          onValueChange={(v) => update({ pilot: Number(v), skillsByHand: false })}
          options={characters.map((c) => ({ value: String(c.id), label: c.name }))}
        />
      </Field>
      <IconButton
        size="sm"
        label="Read skills and fatigue from ESI again"
        icon={<RefreshCw />}
        loading={fill.fetching}
        onClick={() => {
          update({ skillsByHand: false });
          fill.refresh();
        }}
      />
    </div>
  );
}

/** Why ESI did not fill the skills and fatigue, with what to do about it. */
/** ESI scopes the planner reads with: skills (extra `jumps`) and jump fatigue (extra `fatigue`). */
const SKILLS_SCOPE = 'esi-skills.read_skills.v1';
const FATIGUE_SCOPE = 'esi-characters.read_fatigue.v1';

/**
 * What to do when ESI did not fill the skills and fatigue: link again for skills (extra `jumps`),
 * or, with skills in, a quiet offer to read jump fatigue too (extra `fatigue`, asked apart since an
 * EVE application without that scope refuses the whole sign-in).
 */
function PilotHint({ pilot: fill }: PanelState) {
  const { pilot, answer } = fill;
  if (!pilot) return null;
  const linkWith = (extra: OptionalEveScope) =>
    relinkHref(hereForReturn(), [...new Set([...(pilot.extras ?? []), extra])]);
  if (!pilot.tokenValid)
    return (
      <p className={styles.skillsHint}>
        The EVE login of {pilot.name} expired. <a href={linkWith('jumps')}>Link it again</a> to fill the
        skills.
      </p>
    );
  const missing = answer?.missingScopes ?? [];
  if (missing.includes(SKILLS_SCOPE))
    return (
      <p className={styles.skillsHint}>
        <a href={linkWith('jumps')}>Allow skills for {pilot.name}</a> to fill these from EVE.
      </p>
    );
  const problem =
    answer?.problem ?? (fill.error ? errorText(fill.error, 'Skills and fatigue could not be read') : null);
  if (problem)
    return (
      <p className={styles.skillsHint} role="status">
        {problem}
      </p>
    );
  return missing.includes(FATIGUE_SCOPE) ? (
    <p className={styles.skillsHint}>
      <a href={linkWith('fatigue')}>Read jump fatigue too</a>
    </p>
  ) : null;
}

function errorText(error: Error, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function Options({ model, ship, settings, update, avoidSystems, avoidRegions, pilot: fill }: PanelState) {
  const searchAvoid = async (text: string) => {
    const q = text.trim().toLowerCase();
    const regions: AvoidOption[] = model.regionNames
      .filter((name) => name.toLowerCase().startsWith(q))
      .slice(0, 3)
      .map((name) => ({ key: `r:${name}`, kind: 'region', name, label: name, detail: 'Region' }));
    const systems: AvoidOption[] = searchSystems(model, text, 6).map((i) => ({
      key: `s:${model.ids[i]}`,
      kind: 'system',
      name: model.names[i]!,
      label: model.names[i]!,
      leading: <SecPill security={model.security[i]!} />,
      detail: model.regionNames[model.regionOf[i]!],
    }));
    return { options: [...regions, ...systems] };
  };
  return (
    <div className={styles.options}>
      <Field label="Fuel prices">
        <Select
          size="sm"
          value={settings.fuelHub}
          onValueChange={(hub) => update({ fuelHub: hub as JumpFuelHub })}
          options={(Object.keys(HUB_LABELS) as JumpFuelHub[]).map((h) => ({
            value: h,
            label: HUB_LABELS[h],
          }))}
        />
      </Field>
      <Switch
        checked={settings.preferStations}
        onCheckedChange={(on) => update({ preferStations: on })}
        label="Land at NPC stations"
      />
      <Switch
        checked={settings.outlaw}
        onCheckedChange={(on) => update({ outlaw: on })}
        label="Never enter high-sec"
      />
      {ship.ansiblex && (
        <Switch
          checked={settings.ansiblex}
          onCheckedChange={(on) => update({ ansiblex: on })}
          label="Use Ansiblex bridges"
        />
      )}
      <div className={styles.row2}>
        <Field label="Keep fatigue under">
          <Select
            value={settings.maxFatigue === null ? 'off' : String(settings.maxFatigue)}
            onValueChange={(v) => update({ maxFatigue: v === 'off' ? null : Number(v) })}
            options={FATIGUE_CAPS}
          />
        </Field>
        <Field
          label="Fatigue now (min)"
          hint={
            fill.fatigueExpiresAt !== undefined && fill.pilot ? `From ESI · ${fill.pilot.name}` : undefined
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            value={settings.fatigueNow}
            onChange={(e) => update({ fatigueNow: clamp(Number(e.target.value), 0, 300) })}
          />
        </Field>
      </div>
      <Field label="Avoid">
        <SearchPicker<AvoidOption>
          value={null}
          onChange={(o) => {
            if (!o) return;
            if (o.kind === 'region') {
              if (!settings.avoidRegions.includes(o.name))
                update({ avoidRegions: [...settings.avoidRegions, o.name] });
            } else if (!settings.avoidSystems.includes(o.name)) {
              update({ avoidSystems: [...settings.avoidSystems, o.name] });
            }
          }}
          search={searchAvoid}
          cacheKey={['jump-avoid']}
          placeholder="System or region"
        />
      </Field>
      {(avoidSystems.size > 0 || avoidRegions.length > 0) && (
        <ul className={styles.chips} aria-label="Avoided">
          {avoidRegions
            .map((r) => model.regionNames[r]!)
            .map((name) => (
              <li key={`r:${name}`}>
                <Ban aria-hidden />
                {name}
                <IconButton
                  size="sm"
                  label={`Stop avoiding ${name}`}
                  icon={<X />}
                  tooltip={false}
                  onClick={() => update({ avoidRegions: settings.avoidRegions.filter((n) => n !== name) })}
                />
              </li>
            ))}
          {[...avoidSystems]
            .map((i) => model.names[i]!)
            .map((name) => (
              <li key={`s:${name}`}>
                {name}
                <IconButton
                  size="sm"
                  label={`Stop avoiding ${name}`}
                  icon={<X />}
                  tooltip={false}
                  onClick={() =>
                    update({
                      avoidSystems: settings.avoidSystems.filter(
                        (n) => n.toLowerCase() !== name.toLowerCase(),
                      ),
                    })
                  }
                />
              </li>
            ))}
        </ul>
      )}
      {ship.bridges && (
        <Field label={ship.hull === 'titan' ? 'Bridged mass (t)' : 'Covert mass bridged (t)'}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={settings.bridgeTonnes ?? ''}
            placeholder="e.g. 100000"
            onChange={(e) =>
              update({ bridgeTonnes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })
            }
          />
        </Field>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : min;
}

function Result(props: PanelState) {
  const { plan, planning, planError, origin, destination, model } = props;
  // Nothing to say until both ends are picked: the fields say what goes in them.
  if (origin === null || destination === null) return null;
  if (planError) {
    const message = planError instanceof ApiError ? planError.message : 'The server did not answer';
    return (
      <Callout tone="danger" title="No route">
        {message}
      </Callout>
    );
  }
  if (!plan) {
    return (
      <p className={styles.hint} role="status">
        <Spinner label="Planning" /> Planning the route…
      </p>
    );
  }
  const route = plan.route;
  return (
    <section className={styles.result} aria-label="Route" aria-busy={planning || undefined}>
      {!route ? (
        <Callout tone="warning" title="No route">
          {plan.problem?.message}
        </Callout>
      ) : (
        <>
          {/* On a phone the route's totals are in the sheet; else in the bubble over the map. */}
          {props.phone && <RouteChoices {...props} />}
          {props.phone && props.routeOptions.length < 2 && (
            <div className={styles.totals}>
              <div className={styles.totalsMain}>
                {route.jumps} {route.jumps === 1 ? 'jump' : 'jumps'}
                {route.gates > 0 && ` + ${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`}
                {route.ansiblex > 0 && ` + ${route.ansiblex} Ansiblex`}
                <span>{formatLy(route.ly)}</span>
              </div>
            </div>
          )}
          {route.notes.map((note) => (
            <Callout key={note} tone="warning">
              {note}
            </Callout>
          ))}
          {plan.ignoredAnsiblex.length > 0 && (
            <Callout tone="neutral" title="Some Ansiblex bridges were left out">
              {plan.ignoredAnsiblex
                .slice(0, 3)
                .map((x) => `${nameOf(model, x.from)} > ${nameOf(model, x.to)}: ${x.why}`)
                .join('. ')}
            </Callout>
          )}
          {props.phone && <RouteSummary {...props} />}
          {props.phone && <FreightQuoteFold {...props} />}
          {props.phone && plan && (
            <RouteActions plan={plan} onShare={props.onShare} freight={freightDefaults(props)} wide />
          )}
        </>
      )}
    </section>
  );
}

const HUB_LABELS: Record<JumpFuelHub, string> = {
  jita: 'Jita',
  amarr: 'Amarr',
  dodixie: 'Dodixie',
  rens: 'Rens',
  hek: 'Hek',
};

/** What `units` of the ship's isotope cost at the pilot's hub; null without a price. */
function iskOf(units: number, plan: JumpPlanDto, prices: JumpFuelPricesDto | null): number | null {
  const price = prices?.prices[plan.ship.isotope];
  return price == null ? null : units * price;
}

/** The trip in numbers, under its legs: fuel (and what it costs at the hub), fatigue, waiting. */
export function RouteSummary({ plan, fuelPrices }: Pick<PanelState, 'plan' | 'fuelPrices'>) {
  const route = plan?.route;
  if (!plan || !route) return null;
  const isotope = ISOTOPE_LABELS[plan.ship.isotope].toLowerCase();
  const hub = fuelPrices ? HUB_LABELS[fuelPrices.hub] : null;
  const fuelIsk = iskOf(route.fuel, plan, fuelPrices);
  const bridgeIsk = route.bridgeFuel === null ? null : iskOf(route.bridgeFuel, plan, fuelPrices);
  return (
    <section className={styles.summary} aria-label="Route summary">
      <dl className={styles.facts}>
        <div>
          <dt>Fuel</dt>
          <dd>
            {formatNumber(route.fuel)} {isotope}
            {fuelIsk !== null && (
              <small>
                ≈ {formatIsk(fuelIsk)} · {hub}
              </small>
            )}
          </dd>
        </div>
        {route.bridgeFuel !== null && (
          <div>
            <dt>Bridge fuel</dt>
            <dd>
              {formatNumber(route.bridgeFuel)}
              {bridgeIsk !== null && <small>≈ {formatIsk(bridgeIsk)}</small>}
            </dd>
          </div>
        )}
        <div>
          <dt>Fatigue at the end</dt>
          <dd>{formatMinutes(route.fatigueMinutes)}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{formatMinutes(route.waitMinutes)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** A number field that keeps what the pilot types and saves it once it reads as a number. */
function AmountField({
  label,
  value,
  onValue,
  isk,
}: {
  label: string;
  value: number;
  onValue(n: number): void;
  /** Reads "1.5b", "250m", "40k" too. */
  isk?: boolean;
}) {
  const [text, setText] = useState(
    value === 0 ? '' : isk && value >= 1e3 ? formatIskShort(value) : String(value),
  );
  const parse = (t: string) => (t.trim() === '' ? 0 : isk ? parseIsk(t) : Number(t.replace(',', '.')));
  const parsed = parse(text);
  const invalid = parsed === null || !Number.isFinite(parsed) || parsed < 0;
  return (
    <Field label={label} error={invalid ? 'Not a number' : undefined}>
      <Input
        size="sm"
        inputMode="decimal"
        value={text}
        placeholder="0"
        onChange={(e) => {
          setText(e.target.value);
          const n = parse(e.target.value);
          if (n !== null && Number.isFinite(n) && n >= 0) onValue(n);
        }}
        onBlur={() => !invalid && parsed !== null && isk && parsed >= 1e3 && setText(formatIskShort(parsed))}
      />
    </Field>
  );
}

/** "1.5b", "250m", "40k": how a pilot would type it again. */
function formatIskShort(isk: number): string {
  return formatIsk(isk)
    .replace(/ ISK$/, '')
    .replace(/[kMB]$/, (u) => u.toLowerCase());
}

/** The terms of a freight contract (remembered) and what to ask for it along this route. */
function FreightFields({
  plan,
  settings,
  update,
  fuelPrices,
}: Pick<PanelState, 'plan' | 'settings' | 'update' | 'fuelPrices'>) {
  const route = plan?.route;
  if (!plan || !route) return null;
  const terms = settings.freight;
  const set = (change: Partial<FreightTerms>) => update({ freight: { ...terms, ...change } });
  const price = fuelPrices?.prices[plan.ship.isotope] ?? null;
  const quote = price === null ? null : freightQuote(route, price, terms);
  return (
    <>
      <div className={styles.row2}>
        <AmountField label="Cargo (m³)" value={terms.cargoM3} onValue={(cargoM3) => set({ cargoM3 })} />
        <AmountField
          label="Collateral"
          isk
          value={terms.collateral}
          onValue={(collateral) => set({ collateral })}
        />
        <AmountField
          label="Fuel markup (%)"
          value={terms.markupPct}
          onValue={(markupPct) => set({ markupPct })}
        />
        <AmountField
          label="Collateral fee (%)"
          value={terms.collateralPct}
          onValue={(collateralPct) => set({ collateralPct })}
        />
        <AmountField
          label="Base reward"
          isk
          value={terms.baseReward}
          onValue={(baseReward) => set({ baseReward })}
        />
        <AmountField label="Per m³" isk value={terms.perM3} onValue={(perM3) => set({ perM3 })} />
        <AmountField label="Per jump" isk value={terms.perJump} onValue={(perJump) => set({ perJump })} />
        <AmountField
          label="Minimum"
          isk
          value={terms.minReward}
          onValue={(minReward) => set({ minReward })}
        />
        <AmountField
          label="Low-sec fee"
          isk
          value={terms.lowSecFee}
          onValue={(lowSecFee) => set({ lowSecFee })}
        />
      </div>
      {quote ? (
        <dl className={styles.facts} aria-label="Freight quote">
          <div>
            <dt>Charge</dt>
            <dd>
              {formatIsk(quote.charge)}
              {quote.atMinimum && <small>the minimum</small>}
            </dd>
          </div>
          <div>
            <dt>Margin</dt>
            <dd>{formatIsk(quote.margin)}</dd>
          </div>
          {quote.lowSec && terms.lowSecFee > 0 && (
            <div>
              <dt>Low-sec fee</dt>
              <dd>{formatIsk(terms.lowSecFee)}</dd>
            </div>
          )}
          <div>
            <dt>Fuel</dt>
            <dd>{formatIsk(quote.fuelCost)}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.skillsHint}>The fuel price could not be read from the market yet.</p>
      )}
    </>
  );
}

/** The freight quote's charge for the head of its card or sidebar. */
function freightCharge({
  plan,
  settings,
  fuelPrices,
}: Pick<PanelState, 'plan' | 'settings' | 'fuelPrices'>): string {
  const route = plan?.route;
  const price = plan && fuelPrices ? (fuelPrices.prices[plan.ship.isotope] ?? null) : null;
  if (!route || price === null) return 'No fuel price yet';
  return `≈ ${formatIsk(freightQuote(route, price, settings.freight).charge)}`;
}

/**
 * What to ask for carrying a contract along this route (jump freighters): the fuel at the hub
 * price with a markup and the pilot's other terms, as their freight calculator does. A card in
 * a phone's sheet.
 */
function FreightQuoteFold(props: PanelState) {
  if (!props.plan?.route || props.ship.hull !== 'jump_freighter') return null;
  return (
    <Disclosure icon={<Coins aria-hidden />} title="Freight quote" summary={freightCharge(props)}>
      <FreightFields {...props} />
    </Disclosure>
  );
}

/** The freight quote beside the map: a card of its own at the right, folded until opened. */
export function FreightPanel(props: Pick<PanelState, 'plan' | 'settings' | 'update' | 'fuelPrices'>) {
  return (
    <Disclosure
      className={styles.sidePanel}
      icon={<Coins aria-hidden />}
      title="Freight quote"
      summary={freightCharge(props)}
    >
      <FreightFields {...props} />
    </Disclosure>
  );
}

const BEST_LABELS: Record<JumpRouteBest, string> = {
  jumps: 'Fewest jumps',
  fuel: 'Least fuel',
  fatigue: 'Least fatigue',
  wait: 'Shortest wait',
};

/** One line per route, as a maps app lists other ways: the recommended one first, picked by default. */
export function RouteChoices({
  routeOptions,
  chosenRoute,
  onChooseRoute,
  plan,
  fuelPrices,
  floating = false,
}: Pick<PanelState, 'routeOptions' | 'chosenRoute' | 'onChooseRoute' | 'plan' | 'fuelPrices'> & {
  /** The bubble over the map: the route's totals even when there is no other to choose. */
  floating?: boolean;
}) {
  if (!plan?.route || routeOptions.length < (floating ? 1 : 2)) return null;
  const isotope = ISOTOPE_LABELS[plan.ship.isotope].toLowerCase();
  const choosing = routeOptions.length > 1;
  const card = (route: JumpRouteDto, n: number) => {
    const isk = iskOf(route.fuel, plan, fuelPrices);
    return (
      <>
        {/* Glanceable: why this one, how far, what it costs; the legs are in the panel. */}
        {choosing && (
          <span className={styles.choiceTitle}>
            {n === 0 ? 'Recommended' : route.best[0] ? BEST_LABELS[route.best[0]] : 'Alternative'}
          </span>
        )}
        <span className={styles.choiceMain}>
          {route.jumps} {route.jumps === 1 ? 'jump' : 'jumps'}
          {route.gates > 0 && ` + ${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`}
          <span className={styles.choiceLy}>{formatLy(route.ly)}</span>
        </span>
        <dl className={styles.facts}>
          <div>
            <dt>Fuel</dt>
            <dd title={`${formatNumber(route.fuel)} ${isotope}`}>
              {isk !== null ? formatIsk(isk) : `${formatNumber(route.fuel)} ${isotope}`}
            </dd>
          </div>
          <div>
            <dt>Fatigue</dt>
            <dd>{formatMinutes(route.fatigueMinutes)}</dd>
          </div>
        </dl>
      </>
    );
  };
  if (!choosing)
    return (
      <section className={styles.choicesBubble} aria-label="Route totals">
        <div className={styles.choice}>{card(plan.route, 0)}</div>
      </section>
    );
  return (
    <div className={floating ? styles.choicesBubble : styles.choices} role="radiogroup" aria-label="Routes">
      {routeOptions.map((route, n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === chosenRoute}
          className={styles.choice}
          onClick={() => onChooseRoute(n)}
        >
          {card(route, n)}
        </button>
      ))}
    </div>
  );
}

function nameOf(model: StarModel, id: number): string {
  const i = model.indexById.get(id);
  return i === undefined ? 'Unknown system' : model.names[i]!;
}

/** Makes a link anyone can open without signing in, and copies it. */
function ShareButton({
  onShare,
  freight,
  wide = false,
}: Pick<PanelState, 'onShare'> & { freight: JumpShareFreight | null; wide?: boolean }) {
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const share = async (forClient: JumpShareFreight | null = null) => {
    setSharing(true);
    try {
      const url = await onShare(forClient);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast({
        tone: 'success',
        title: forClient ? 'Freight quote link copied' : 'Share link copied',
        description: forClient
          ? `${url} shows the route and ${formatIsk(forClient.price)}, never the fuel.`
          : `Anyone with ${url} sees this route, without signing in.`,
      });
      return true;
    } catch (error) {
      toast({
        tone: 'danger',
        title: 'Could not share the route',
        description: error instanceof ApiError ? error.message : undefined,
      });
      return false;
    } finally {
      setSharing(false);
    }
  };
  // In the panel's header the actions are alike: icons, named by their tooltips.
  const trigger = (onClick?: () => void) =>
    wide ? (
      <Button icon={<Link2 />} loading={sharing} onClick={onClick}>
        Share
      </Button>
    ) : (
      <IconButton
        size="sm"
        variant="secondary"
        label="Share"
        icon={<Link2 />}
        loading={sharing}
        onClick={onClick}
      />
    );
  // A jump freighter's route can also go to a client as a freight quote.
  if (!freight) return trigger(() => void share());
  return (
    <>
      <Menu>
        <MenuTrigger asChild>{trigger()}</MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => void share()}>Route for pilots</MenuItem>
          <MenuItem onSelect={() => setQuoting(true)}>Freight quote for a client…</MenuItem>
        </MenuContent>
      </Menu>
      <FreightShareDialog
        open={quoting}
        onOpenChange={setQuoting}
        defaults={freight}
        onShare={async (quote) => {
          if (await share(quote)) setQuoting(false);
        }}
      />
    </>
  );
}

/**
 * The client's link: the route and what to pay, the quote unless set by hand, with the cargo and
 * collateral it is for. Nothing about fuel goes out with it.
 */
function FreightShareDialog({
  open,
  onOpenChange,
  defaults,
  onShare,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  defaults: JumpShareFreight;
  onShare(freight: JumpShareFreight): Promise<void>;
}) {
  // The form starts again from the quote of the moment each time it opens.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FreightShareForm defaults={defaults} onShare={onShare} />}
    </Dialog>
  );
}

function FreightShareForm({
  defaults,
  onShare,
}: {
  defaults: JumpShareFreight;
  onShare(freight: JumpShareFreight): Promise<void>;
}) {
  const [price, setPrice] = useState(defaults.price);
  const [cargoM3, setCargo] = useState(defaults.cargoM3 ?? 0);
  const [collateral, setCollateral] = useState(defaults.collateral ?? 0);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent
      title="Freight quote for a client"
      description="A link with the route and this price. It shows no fuel, fatigue or skills."
      width={420}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            icon={<Link2 />}
            loading={busy}
            disabled={price <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onShare({
                  price,
                  cargoM3: cargoM3 > 0 ? cargoM3 : null,
                  collateral: collateral > 0 ? collateral : null,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Copy link
          </Button>
        </>
      }
    >
      <div className={styles.options}>
        <AmountField label="Price (ISK)" isk value={price} onValue={setPrice} />
        <div className={styles.row2}>
          <AmountField label="Cargo (m³)" value={cargoM3} onValue={setCargo} />
          <AmountField label="Collateral" isk value={collateral} onValue={setCollateral} />
        </div>
      </div>
    </DialogContent>
  );
}

/** What a client's freight quote starts from: the planner's quote and the pilot's terms. */
function freightDefaults({ plan, ship, settings, fuelPrices }: PanelState): JumpShareFreight | null {
  const route = plan?.route;
  if (!plan || !route || ship.hull !== 'jump_freighter') return null;
  const price = fuelPrices?.prices[plan.ship.isotope] ?? null;
  const quote = price === null ? null : freightQuote(route, price, settings.freight);
  return {
    price: quote ? Math.round(quote.charge) : 0,
    cargoM3: settings.freight.cargoM3 || null,
    collateral: settings.freight.collateral || null,
  };
}

/**
 * What to do with the route: copy it, set it as in-game waypoints, share it. Small, in the
 * panel's header beside the map; `wide` for a phone's sheet, with words on every button.
 */
function RouteActions({
  plan,
  onShare,
  freight,
  wide = false,
}: Pick<PanelState, 'onShare'> & { plan: JumpPlanDto; freight: JumpShareFreight | null; wide?: boolean }) {
  const toast = useToast();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const pilots = (me.data?.characters ?? []).filter((c) => c.canSetWaypoints && c.tokenValid);
  const route = plan.route;
  if (!route) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(routeText(plan));
      toast({ tone: 'success', title: 'Route copied' });
    } catch {
      toast({
        tone: 'danger',
        title: 'Could not copy',
        description: 'The browser did not allow the clipboard.',
      });
    }
  };

  const waypoints = async (characterId: number, name: string) => {
    setBusy(true);
    try {
      for (const [n, leg] of route.legs.entries()) {
        await api<void>(buildPath(routes.routing.waypoint.path, { characterId: String(characterId) }), {
          method: 'POST',
          json: {
            solarSystemId: leg.to.id,
            mode: n === 0 ? 'destination' : 'waypoint',
          } satisfies WaypointRequest,
        });
      }
      toast({
        tone: 'success',
        title: `Waypoints set for ${name}`,
        description: `${route.legs.length} stops, in order.`,
      });
    } catch (error) {
      toast({
        tone: 'danger',
        title: 'Could not set the waypoints',
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={wide ? styles.actions : styles.headActions}>
      {wide ? (
        <Button icon={<Copy />} onClick={() => void copy()}>
          Copy
        </Button>
      ) : (
        <IconButton
          size="sm"
          variant="secondary"
          label="Copy route"
          icon={<Copy />}
          onClick={() => void copy()}
        />
      )}
      {pilots.length > 0 && (
        <Menu>
          <MenuTrigger asChild>
            {wide ? (
              <Button icon={<Navigation />} loading={busy}>
                Waypoints
              </Button>
            ) : (
              <IconButton
                size="sm"
                variant="secondary"
                label="Set in-game waypoints"
                icon={<Navigation />}
                loading={busy}
              />
            )}
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>In-game waypoints for</MenuLabel>
            {pilots.map((c) => (
              <MenuItem key={c.id} onSelect={() => void waypoints(c.id, c.name)}>
                {c.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <ShareButton onShare={onShare} freight={freight} wide={wide} />
    </div>
  );
}
