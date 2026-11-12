'use client';

import {
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
  ChevronLeft,
  ChevronRight,
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
  type JumpMetaDto,
  type JumpPlanDto,
  type JumpRouteBest,
  type JumpRouteDto,
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
  Field,
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
  Textarea,
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
import type { AnsiblexParse, PlannerSettings } from './settings';
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
  ansiblex: AnsiblexParse;
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
  onShare(): Promise<string>;
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
  /** What each picker offers on focus and ranks first while typing. */
  suggestions: Readonly<Record<End, readonly Suggestion[]>>;
  ref?: Ref<HTMLDivElement>;
}

type PanelState = Omit<JumpPanelProps, 'ref'>;

/** The planner's controls: ship, start and destination, skills, options, and the route found. */
export function JumpPanel({ ref, ...props }: JumpPanelProps) {
  const { model, ship, settings, update, origin, destination, plan, open, setOpen, phone } = props;
  const [optionsOpen, setOptionsOpen] = useState(false);
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
    const place = `${securityLabel(model.security[i]!)} · ${model.regionNames[model.regionOf[i]!]}`;
    return {
      key: String(model.ids[i]),
      index: i,
      label: model.names[i]!,
      detail: why ? `${whyLabel(why)} · ${place}` : place,
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
          {open && (
            <div>
              <h1 className={styles.title}>Jump planner</h1>
            </div>
          )}
          <IconButton
            label={open ? 'Hide the controls' : 'Show the controls'}
            icon={open ? <ChevronLeft /> : <ChevronRight />}
            tooltipSide="right"
            onClick={() => setOpen(!open)}
          />
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

          <div className={styles.endpoints}>
            <PointRow n={0} label="Start" drag={drag} grip={grip}>
              <SearchPicker<SystemOption>
                value={origin === null ? null : option(origin)}
                onChange={(o) => props.setOrigin(o?.index ?? null)}
                search={searchFor('origin')}
                cacheKey={['jump-systems', 'origin', suggestionsKey('origin')]}
                minLength={0}
                debounce={0}
                placeholder="System name ( / )"
                empty="No known-space system by that name"
              />
            </PointRow>
            {props.stops.map((stop, n) => (
              <PointRow
                key={n}
                n={n + 1}
                label={`Stop ${n + 1}`}
                drag={drag}
                grip={grip}
                remove={() => props.removeStop(n)}
              >
                <SearchPicker<SystemOption>
                  value={stop === null ? null : option(stop)}
                  onChange={(o) => props.setStop(n, o?.index ?? null)}
                  search={searchFor('destination')}
                  cacheKey={['jump-systems', 'stop', suggestionsKey('destination')]}
                  minLength={0}
                  debounce={0}
                  placeholder="System name"
                  empty="No known-space system by that name"
                />
              </PointRow>
            ))}
            {/* Stops go between the ends, so they are added there too. */}
            <div className={styles.addStop}>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus />}
                disabled={props.stops.length >= 10}
                onClick={props.addStop}
              >
                Add stop
              </Button>
            </div>
            <PointRow n={points - 1} label="Destination" drag={drag} grip={grip}>
              <SearchPicker<SystemOption>
                value={destination === null ? null : option(destination)}
                onChange={(o) => props.setDestination(o?.index ?? null)}
                search={searchFor('destination')}
                cacheKey={['jump-systems', 'destination', suggestionsKey('destination')]}
                minLength={0}
                debounce={0}
                placeholder="System name"
                empty="No known-space system by that name"
              />
            </PointRow>
          </div>
          <div className={styles.endpointActions}>
            <Switch
              checked={settings.roundTrip}
              onCheckedChange={(on) => update({ roundTrip: on })}
              label="Return to start"
            />
          </div>

          <button
            type="button"
            className={styles.optionsToggle}
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            <SlidersHorizontal aria-hidden />
            <span>Route options</span>
            <span className={styles.optionsSummary}>{optionsSummary(settings, props)}</span>
            {optionsOpen ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </button>
          {optionsOpen && <Options {...props} />}

          <PilotSkills {...props} />

          <Result {...props} />
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

/** One point of the trip: a grip to reorder it, its picker, and × for a stop. */
function PointRow({
  n,
  label,
  drag,
  grip,
  remove,
  children,
}: {
  n: number;
  label: string;
  drag: Drag | null;
  grip(n: number): GripHandlers;
  remove?(): void;
  children: ReactNode;
}) {
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
      <Field label={label}>{children}</Field>
      {remove ? (
        <IconButton size="sm" label={`Remove ${label.toLowerCase()}`} icon={<X />} onClick={remove} />
      ) : (
        <span className={styles.pointSpacer} aria-hidden />
      )}
    </div>
  );
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
  if (settings.gates === 'never') parts.push('no gates');
  if (settings.gates === 'shortcut') parts.push('gate shortcuts');
  if (settings.preferStations) parts.push('stations');
  if (settings.outlaw) parts.push('outlaw');
  if (settings.fatigueNow > 0) parts.push(`fatigue now ${formatMinutes(settings.fatigueNow)}`);
  if (settings.maxFatigue !== null) parts.push(`fatigue ≤ ${formatMinutes(settings.maxFatigue)}`);
  const avoided = props.avoidSystems.size + props.avoidRegions.length;
  if (avoided > 0) parts.push(`${avoided} avoided`);
  if (props.ship.ansiblex && props.ansiblex.pairs.length > 0)
    parts.push(`${props.ansiblex.pairs.length} Ansiblex`);
  return parts.join(' · ');
}

interface AvoidOption extends PickerOption {
  kind: 'system' | 'region';
  name: string;
}

const roman = (n: number) => LEVELS[n]?.label ?? String(n);

/**
 * The pilot's skills, folded away: they change rarely and ESI fills them in. The summary says
 * where the levels come from, and warns when they are only assumed (fuel and range follow them).
 */
function PilotSkills(props: PanelState) {
  const { pilot: fill, settings, update, ship } = props;
  const [open, setOpen] = useState(false);
  const { skills } = settings;
  const levels = [
    `${formatRange(props.rangeLy)} range`,
    `JDC ${roman(skills.jdc)}`,
    `JFC ${roman(skills.jfc)}`,
    ...(ship.hull === 'jump_freighter' ? [`JF ${roman(skills.jf)}`] : []),
  ].join(' · ');
  // Picked by hand wins over ESI until ESI is asked again or the pilot changes.
  const byHand = settings.skillsByHand;
  const fromEsi = !byHand && fill.skills !== null && fill.pilot !== null;
  const source = fromEsi ? fill.pilot!.name : byHand ? 'set by hand' : 'assumed';
  // Only missing skills (or an expired login) call for linking again; fatigue is a quiet extra.
  const needsLink = skillsNeedLink(fill);
  return (
    <>
      <button
        type="button"
        className={styles.optionsToggle}
        aria-expanded={open}
        data-warn={(!fromEsi && !byHand) || undefined}
        onClick={() => setOpen(!open)}
      >
        {!fromEsi && !byHand ? <TriangleAlert aria-hidden /> : <UserRound aria-hidden />}
        <span>Skills</span>
        <span className={styles.optionsSummary}>
          {levels} · {source}
        </span>
        {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
      {open && (
        <div className={styles.options}>
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
          {/* What to do about it when EVE could fill them, else where they come from. */}
          {needsLink ? (
            <PilotHint {...props} />
          ) : (
            <>
              <p className={styles.skillsHint}>
                {fromEsi
                  ? `From ESI · ${fill.pilot!.name}`
                  : byHand
                    ? 'Set by hand · refresh to read ESI again'
                    : 'Not read from EVE: fuel and range use these levels.'}
              </p>
              <PilotHint {...props} />
            </>
          )}
        </div>
      )}
    </>
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

/** The skills scope is missing or the login expired: the levels cannot come from EVE. */
function skillsNeedLink(fill: PilotFill): boolean {
  if (!fill.pilot) return false;
  return !fill.pilot.tokenValid || (fill.answer?.missingScopes.includes(SKILLS_SCOPE) ?? false);
}

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

function Options({
  model,
  ship,
  settings,
  update,
  ansiblex,
  avoidSystems,
  avoidRegions,
  pilot: fill,
}: PanelState) {
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
      detail: `${securityLabel(model.security[i]!)} · ${model.regionNames[model.regionOf[i]!]}`,
    }));
    return { options: [...regions, ...systems] };
  };
  return (
    <div className={styles.options}>
      <Switch
        checked={settings.gates !== 'never'}
        onCheckedChange={(on) => update({ gates: on ? 'finish' : 'never' })}
        label="Finish over stargates"
        description={
          ship.highSec
            ? 'Gates after the last jump, only where no jump reaches, e.g. into high-sec.'
            : 'Gates after the last jump, where no cyno can be lit.'
        }
      />
      <Switch
        checked={settings.gates === 'shortcut'}
        disabled={settings.gates === 'never'}
        onCheckedChange={(on) => update({ gates: on ? 'shortcut' : 'finish' })}
        label="Allow jump gates"
        description="Up to three stargates after the last jump when they save jumps, e.g. into a system one gate on."
      />
      <Field label="Fuel prices" hint="Lowest sell order at the hub's main station.">
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
        label="Stop at NPC stations"
        description="Even when it costs more fuel."
      />
      <Switch
        checked={settings.outlaw}
        onCheckedChange={(on) => update({ outlaw: on })}
        label="Outlaw"
        description="Never enter high-sec."
      />
      <div className={styles.row2}>
        <Field label="Keep fatigue under">
          <Select
            value={settings.maxFatigue === null ? 'off' : String(settings.maxFatigue)}
            onValueChange={(v) => update({ maxFatigue: v === 'off' ? null : Number(v) })}
            options={FATIGUE_CAPS}
          />
        </Field>
        <Field
          label="Fatigue now"
          hint={
            fill.fatigueExpiresAt !== undefined && fill.pilot
              ? `Minutes, from ESI · ${fill.pilot.name}`
              : 'Minutes'
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
      <Field label="Avoid" hint="Systems and regions the route never stops in or passes.">
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
      {ship.ansiblex && (
        <Field
          label="Ansiblex bridges"
          hint="One per line, e.g. 1DQ1-A > T5ZI-S. Your alliance's own, at most 5 ly apart."
          error={
            ansiblex.problems.length > 0
              ? `Not understood: ${ansiblex.problems.slice(0, 2).join('; ')}`
              : undefined
          }
        >
          <Textarea
            rows={3}
            value={settings.ansiblex}
            onChange={(e) => update({ ansiblex: e.target.value })}
            spellCheck={false}
          />
        </Field>
      )}
      {ship.bridges && (
        <Field
          label={ship.hull === 'titan' ? 'Bridged mass' : 'Mass bridged (covert ships)'}
          hint="Tonnes per bridge, for the bridge fuel of each leg."
        >
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
  const { plan, planning, planError, origin, destination, model, activeLeg, setActiveLeg, onShowLeg } = props;
  if (origin === null || destination === null) {
    const hint =
      origin === null
        ? 'Search for a start, or click a system on the map.'
        : 'Now a destination: search, or click a system on the map.';
    return <p className={styles.hint}>{hint}</p>;
  }
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
          {/* On a phone the routes to choose from are in the sheet; else over the map. */}
          {props.phone && <RouteChoices {...props} />}
          {(!props.phone || props.routeOptions.length < 2) && (
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
          <RouteLegs route={route} activeLeg={activeLeg} setActiveLeg={setActiveLeg} onShowLeg={onShowLeg} />
          <RouteSummary {...props} />
          <FreightQuoteFold {...props} />
          <RouteActions {...props} />
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
  const [text, setText] = useState(value === 0 ? '' : String(value));
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

/**
 * What to ask for carrying a contract along this route, folded under the summary: the fuel at the
 * hub price with a markup and the pilot's other terms (remembered), as their freight calculator does.
 */
function FreightQuoteFold({ plan, ship, settings, update, fuelPrices }: PanelState) {
  const [open, setOpen] = useState(false);
  const route = plan?.route;
  if (!plan || !route || ship.hull !== 'jump_freighter') return null;
  const terms = settings.freight;
  const set = (change: Partial<FreightTerms>) => update({ freight: { ...terms, ...change } });
  const price = fuelPrices?.prices[plan.ship.isotope] ?? null;
  const quote = price === null ? null : freightQuote(route, price, terms);
  return (
    <>
      <button
        type="button"
        className={styles.optionsToggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Coins aria-hidden />
        <span>Freight quote</span>
        <span className={styles.optionsSummary}>
          {quote ? `≈ ${formatIsk(quote.charge)}` : 'No fuel price yet'}
        </span>
        {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
      {open && (
        <div className={styles.options}>
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
              <div>
                <dt>Fuel</dt>
                <dd>
                  {formatIsk(quote.fuelCost)}
                  <small>
                    {formatNumber(quote.fuelM3)} m³ · {formatNumber(price!)} ISK/u ·{' '}
                    {HUB_LABELS[fuelPrices!.hub]}
                  </small>
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.skillsHint}>The fuel price could not be read from the market yet.</p>
          )}
        </div>
      )}
    </>
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
  /** A bubble over the map (the free space beside the panel) rather than a list in the panel. */
  floating?: boolean;
}) {
  if (routeOptions.length < 2 || !plan?.route) return null;
  const isotope = ISOTOPE_LABELS[plan.ship.isotope].toLowerCase();
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
          {/* Glanceable: why this one, how many jumps, what it costs; the legs are in the panel. */}
          <span className={styles.choiceTitle}>
            {n === 0 ? 'Recommended' : route.best[0] ? BEST_LABELS[route.best[0]] : 'Alternative'}
          </span>
          <span className={styles.choiceMain}>
            {route.jumps} {route.jumps === 1 ? 'jump' : 'jumps'}
            {route.gates > 0 && ` + ${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`}
          </span>
          <span className={styles.choiceMeta}>
            {iskOf(route.fuel, plan, fuelPrices) !== null
              ? formatIsk(iskOf(route.fuel, plan, fuelPrices)!)
              : `${formatNumber(route.fuel)} ${isotope}`}
            {' · '}fatigue {formatMinutes(route.fatigueMinutes)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The legs of a route, one row each; the row under the pointer is drawn bold on the map. */
export function RouteLegs({
  route,
  activeLeg,
  setActiveLeg,
  onShowLeg,
}: {
  route: JumpRouteDto;
  activeLeg: number | null;
  setActiveLeg(n: number | null): void;
  onShowLeg(n: number): void;
}) {
  return (
    <ol className={styles.legs}>
      {route.legs.map((leg, n) => (
        <li
          key={`${leg.from.id}-${leg.to.id}-${n}`}
          data-active={activeLeg === n || undefined}
          data-kind={leg.kind}
          onMouseEnter={() => setActiveLeg(n)}
          onMouseLeave={() => setActiveLeg(null)}
        >
          <button type="button" className={styles.leg} onClick={() => onShowLeg(n)}>
            <span className={styles.legNumber}>{n + 1}</span>
            <span className={styles.legMain}>
              <span className={styles.legTitle}>
                <span className={styles.secPill} style={{ background: securityColor(leg.to.security) }}>
                  {securityLabel(leg.to.security)}
                </span>
                {leg.to.name}
                {leg.kind !== 'jump' && <em>{leg.kind === 'gate' ? 'gate' : 'Ansiblex'}</em>}
                {leg.stop && <em data-stop>stop</em>}
              </span>
              <span className={styles.legMeta}>
                {leg.kind === 'jump'
                  ? [
                      formatLy(leg.ly),
                      `${formatNumber(leg.fuel)} fuel`,
                      ...(leg.bridgeFuel !== null ? [`bridge ${formatNumber(leg.bridgeFuel)}`] : []),
                      ...(leg.waitMinutes > 0 ? [`wait ${formatMinutes(leg.waitMinutes)}`] : []),
                      `fatigue ${formatMinutes(leg.fatigueMinutes)}`,
                    ].join(' · ')
                  : `${leg.to.region}${leg.waitMinutes > 0 ? ` · wait ${formatMinutes(leg.waitMinutes)}` : ''}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function nameOf(model: StarModel, id: number): string {
  const i = model.indexById.get(id);
  return i === undefined ? 'Unknown system' : model.names[i]!;
}

function RouteActions({ plan, onShare }: PanelState) {
  const toast = useToast();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const pilots = (me.data?.characters ?? []).filter((c) => c.canSetWaypoints && c.tokenValid);
  const route = plan?.route;
  if (!plan || !route) return null;

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

  const share = async () => {
    setSharing(true);
    try {
      const url = await onShare();
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast({
        tone: 'success',
        title: 'Share link copied',
        description: `Anyone with ${url} sees this route, without signing in.`,
      });
    } catch (error) {
      toast({
        tone: 'danger',
        title: 'Could not share the route',
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setSharing(false);
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
    <div className={styles.actions}>
      <Button icon={<Copy />} onClick={() => void copy()}>
        Copy route
      </Button>
      <Button icon={<Link2 />} loading={sharing} onClick={() => void share()}>
        Share link
      </Button>
      {pilots.length > 0 ? (
        <Menu>
          <MenuTrigger asChild>
            <Button icon={<Navigation />} loading={busy}>
              Set waypoints
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>In-game waypoints for</MenuLabel>
            {pilots.map((c) => (
              <MenuItem key={c.id} onSelect={() => void waypoints(c.id, c.name)}>
                {c.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ) : (
        <span className={styles.actionsHint}>
          To set waypoints in game, link a character on the <a href="/account">account page</a>.
        </span>
      )}
    </div>
  );
}
