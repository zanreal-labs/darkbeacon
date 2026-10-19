'use client';

import { useState, type Ref } from 'react';
import {
  ArrowUpDown,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Navigation,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  buildPath,
  JUMP_HULLS,
  routes,
  type JumpHull,
  type JumpMetaDto,
  type JumpPlanDto,
  type JumpShipDto,
  type WaypointRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
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
  formatRange,
  HULL_LABELS,
  ISOTOPE_LABELS,
  routeText,
} from './format';
import { searchSystems, securityColor, securityLabel, type StarModel } from './model';
import type { AnsiblexParse, PlannerSettings } from './settings';
import { rankSystems, whyLabel, type End, type Suggestion, type SuggestionWhy } from './suggest';
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
  settings: PlannerSettings;
  update(change: Partial<PlannerSettings>): void;
  origin: number | null;
  destination: number | null;
  setOrigin(i: number | null): void;
  setDestination(i: number | null): void;
  /** Start and destination change places, in one step. */
  onSwap(): void;
  /** The pointer or focus is on the swap button: a chance to get the reverse route early. */
  onSwapIntent(): void;
  avoidSystems: ReadonlySet<number>;
  avoidRegions: readonly number[];
  ansiblex: AnsiblexParse;
  rangeLy: number;
  plan: JumpPlanDto | null;
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
  // Turns the swap icon half a turn per swap (the only motion; the values change in place).
  const [swaps, setSwaps] = useState(0);
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
              <p className={styles.lede}>Capital jump routes across known space.</p>
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
          <p className={styles.shipFacts}>
            {formatRange(props.rangeLy)} range · {formatNumber(ship.fuelPerLy)}{' '}
            {ISOTOPE_LABELS[ship.isotope].toLowerCase()} per ly ·{' '}
            {ship.cyno === 'regular' ? 'normal' : ship.cyno} cyno
            {ship.fatigueMultiplier < 1 &&
              ` · ${Math.round((1 - ship.fatigueMultiplier) * 100)} % less fatigue`}
          </p>

          <div className={styles.endpoints}>
            <div data-picker="origin">
              <Field label="Start">
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
              </Field>
            </div>
            {/* Always there (disabled with no ends), so nothing moves when it becomes useful. */}
            <IconButton
              className={styles.swap}
              label="Swap start and destination"
              icon={<ArrowUpDown data-turned={swaps % 2 === 1 || undefined} />}
              disabled={origin === null && destination === null}
              onPointerEnter={props.onSwapIntent}
              onPointerDown={props.onSwapIntent}
              onFocus={props.onSwapIntent}
              onClick={() => {
                setSwaps((n) => n + 1);
                props.onSwap();
              }}
            />
            <div data-picker="destination">
              <Field label="Destination">
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
              </Field>
            </div>
          </div>

          <div className={styles.skills}>
            <Field label="Calibration">
              <Select
                size="sm"
                value={String(settings.skills.jdc)}
                onValueChange={(v) => update({ skills: { ...settings.skills, jdc: Number(v) } })}
                options={LEVELS}
              />
            </Field>
            <Field label="Conservation">
              <Select
                size="sm"
                value={String(settings.skills.jfc)}
                onValueChange={(v) => update({ skills: { ...settings.skills, jfc: Number(v) } })}
                options={LEVELS}
              />
            </Field>
            {ship.hull === 'jump_freighter' && (
              <Field label="Freighters">
                <Select
                  size="sm"
                  value={String(settings.skills.jf)}
                  onValueChange={(v) => update({ skills: { ...settings.skills, jf: Number(v) } })}
                  options={LEVELS}
                />
              </Field>
            )}
          </div>

          <p className={styles.skillsHint}>
            Jump Drive Calibration, Jump Fuel Conservation
            {ship.hull === 'jump_freighter' ? ' and Jump Freighters' : ''}.
          </p>

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

          <Result {...props} />
        </div>
      )}
    </aside>
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
  if (settings.preferStations) parts.push('stations');
  if (settings.outlaw) parts.push('outlaw');
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

function Options({ model, ship, settings, update, ansiblex, avoidSystems, avoidRegions }: PanelState) {
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
        checked={settings.gates === 'finish'}
        onCheckedChange={(on) => update({ gates: on ? 'finish' : 'never' })}
        label="Finish over stargates"
        description={
          ship.highSec
            ? 'Gates after the last jump, only where no jump reaches, e.g. into high-sec.'
            : 'Gates after the last jump, where no cyno can be lit.'
        }
      />
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
        <Field label="Fatigue now" hint="Minutes">
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
          <div className={styles.totals}>
            <div className={styles.totalsMain}>
              {route.jumps} {route.jumps === 1 ? 'jump' : 'jumps'}
              {route.gates > 0 && ` + ${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`}
              {route.ansiblex > 0 && ` + ${route.ansiblex} Ansiblex`}
              <span>{formatLy(route.ly)}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Fuel</dt>
                <dd>
                  {formatNumber(route.fuel)} {ISOTOPE_LABELS[plan.ship.isotope].toLowerCase()}
                </dd>
              </div>
              <div>
                <dt>Fatigue at the end</dt>
                <dd>{formatMinutes(route.fatigueMinutes)}</dd>
              </div>
              <div>
                <dt>Waiting</dt>
                <dd>{formatMinutes(route.waitMinutes)}</dd>
              </div>
              {route.bridgeFuel !== null && (
                <div>
                  <dt>Bridge fuel</dt>
                  <dd>{formatNumber(route.bridgeFuel)}</dd>
                </div>
              )}
            </dl>
          </div>
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
          <RouteActions {...props} />
        </>
      )}
    </section>
  );
}

function nameOf(model: StarModel, id: number): string {
  const i = model.indexById.get(id);
  return i === undefined ? 'Unknown system' : model.names[i]!;
}

function RouteActions({ plan }: PanelState) {
  const toast = useToast();
  const me = useMe();
  const [busy, setBusy] = useState(false);
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
