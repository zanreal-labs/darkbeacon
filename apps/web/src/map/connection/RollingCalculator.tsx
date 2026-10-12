'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Hourglass, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type {
  ConnectionIntelDto,
  MassRange,
  RollPlanDto,
  RollStepDto,
  ShipTypeDto,
} from '@darkbeacon/shared';
import { ApiError } from '../../lib/api';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  IconButton,
  Input,
  Skeleton,
} from '../../ui';
import { requestRollPlan, useShipCatalog } from './data';
import {
  formatRange,
  formatTonnes,
  jumpsUntil,
  MASS_WORD,
  ROLL_HEADLINE as HEADLINE,
  ROLL_TEXT as TEXT,
} from './format';
import { shipIcon, ShipPicker, type ShipOption } from './ShipPicker';
import styles from './connection.module.css';

interface CrewEntry {
  ship: ShipTypeDto;
  higgs: boolean;
  entangler: boolean;
  count: number;
}

const tonnesText = (kg: number) => String(Math.round(kg / 1000));

/** What the step says about closing the hole, in words. */
function collapseWord(step: RollStepDto): string | null {
  if (step.collapse === 'none') return null;
  if (step.direction === 'out') return step.collapse === 'will' ? 'Closes it' : 'May close it';
  return step.collapse === 'will' ? 'Closes it' : 'May close it';
}

/**
 * "Plan a roll": the crew's ships (picked by name, Higgs Anchor and mass entangler where they fit,
 * how many), what is left of the hole (the estimate, or what the crew knows), and the server's
 * plan: round trips out cold and back hot, each jump with what may be left after it and whether it
 * may close the hole. A compact "jumps until half / critical / collapse" table per ship.
 */
export function RollingCalculator({
  open,
  onOpenChange,
  mapId,
  connectionId,
  intel,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  mapId: string;
  connectionId: string;
  intel: ConnectionIntelDto | undefined;
}) {
  const catalog = useShipCatalog();
  const [crew, setCrew] = useState<CrewEntry[]>([]);
  const [picking, setPicking] = useState<ShipOption | null>(null);
  const [override, setOverride] = useState(false);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');

  const estimate = intel?.mass.range ?? null;
  useEffect(() => {
    if (!override || !estimate || minText || maxText) return;
    // Start editing from the estimate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMinText(tonnesText(estimate.min));
    setMaxText(tonnesText(estimate.max));
  }, [override, estimate, minText, maxText]);

  const known: MassRange | undefined = useMemo(() => {
    if (!override) return undefined;
    const min = Number(minText) * 1000;
    const max = Number(maxText) * 1000;
    return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min ? { min, max } : undefined;
  }, [override, minText, maxText]);

  const body = useMemo(
    () => ({
      ships: crew.map((c) => ({
        shipTypeId: c.ship.id,
        ...(c.higgs ? { higgs: true } : {}),
        ...(c.entangler ? { entangler: true } : {}),
        count: c.count,
      })),
      ...(known ? { remaining: known } : {}),
    }),
    [crew, known],
  );

  const plan = useQuery({
    queryKey: ['roll-plan', mapId, connectionId, body],
    queryFn: () => requestRollPlan(mapId, connectionId, body),
    enabled: open && crew.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });

  const add = (option: ShipOption | null) => {
    setPicking(null);
    if (!option) return;
    setCrew((c) => {
      const at = c.findIndex((e) => e.ship.id === option.ship.id);
      if (at >= 0) return c.map((e, i) => (i === at ? { ...e, count: Math.min(5, e.count + 1) } : e));
      return [...c, { ship: option.ship, higgs: false, entangler: option.ship.entangler, count: 1 }];
    });
  };
  const change = (index: number, patch: Partial<CrewEntry>) =>
    setCrew((c) => c.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const result: RollPlanDto | undefined = crew.length > 0 ? plan.data : undefined;
  const tone = result?.result === 'ok' ? 'success' : result?.result === 'risky' ? 'warning' : 'danger';
  const total = intel?.mass.total ?? null;
  const remaining = result?.remaining ?? known ?? estimate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Plan a roll"
        description="Round trips out cold and back hot, so the hole closes on a jump home."
        width={720}
        footer={
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        }
      >
        <div className={styles.form}>
          <section aria-label="Crew" className={styles.crew}>
            <h3 className={styles.subhead}>Ships</h3>
            {crew.length > 0 && (
              <ul className={styles.crewList}>
                {crew.map((entry, i) => {
                  const facts = result?.crew.find((c) => c.shipTypeId === entry.ship.id);
                  return (
                    <li key={entry.ship.id} className={styles.crewRow}>
                      <img src={shipIcon(entry.ship.id)} alt="" width={24} height={24} />
                      <span className={styles.crewName}>
                        {entry.ship.name}
                        {facts && (
                          <span className={styles.muted}>
                            {' '}
                            {formatTonnes(facts.cold)} cold · {formatTonnes(facts.hot)} hot
                          </span>
                        )}
                        {facts?.tooHeavy && <span className={styles.danger}> too heavy</span>}
                      </span>
                      {entry.ship.higgs && (
                        <Checkbox
                          checked={entry.higgs}
                          onCheckedChange={(on) => change(i, { higgs: on === true })}
                          label="Higgs"
                        />
                      )}
                      {entry.ship.entangler && (
                        <Checkbox
                          checked={entry.entangler}
                          onCheckedChange={(on) => change(i, { entangler: on === true })}
                          label="Entangler out"
                        />
                      )}
                      <Input
                        size="sm"
                        type="number"
                        min={1}
                        max={5}
                        aria-label={`How many ${entry.ship.name}`}
                        className={styles.count}
                        value={entry.count}
                        onChange={(e) =>
                          change(i, {
                            count: Math.min(5, Math.max(1, Math.round(Number(e.target.value)) || 1)),
                          })
                        }
                      />
                      <IconButton
                        size="sm"
                        label={`Remove ${entry.ship.name}`}
                        icon={<Trash2 />}
                        onClick={() => setCrew((c) => c.filter((_, j) => j !== i))}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {crew.length < 8 && (
              <div className={styles.addShip}>
                <Plus aria-hidden className={styles.addIcon} />
                <ShipPicker
                  value={picking}
                  onChange={add}
                  suggested={catalog.data?.suggested}
                  aria-label="Add a ship"
                />
              </div>
            )}
          </section>

          <section aria-label="What is left" className={styles.left}>
            <h3 className={styles.subhead}>What is left</h3>
            <p className={styles.muted}>
              {estimate
                ? `By the estimate ${formatRange(estimate, formatTonnes)}${
                    intel ? ` (marked ${MASS_WORD[intel.massStatus].toLowerCase()})` : ''
                  }.`
                : 'Unknown: the hole’s type is not known.'}
              {intel?.maxJumpMass ? ` At most ${formatTonnes(intel.maxJumpMass)} a jump.` : ''}
            </p>
            <Checkbox
              checked={override}
              onCheckedChange={(on) => setOverride(on === true)}
              label="We know better"
              description="Say how much is left, in tonnes"
            />
            {override && (
              <div className={styles.row2}>
                <Input
                  aria-label="At least (tonnes)"
                  inputMode="numeric"
                  value={minText}
                  trailing="t at least"
                  onChange={(e) => setMinText(e.target.value)}
                />
                <Input
                  aria-label="At most (tonnes)"
                  inputMode="numeric"
                  value={maxText}
                  trailing="t at most"
                  onChange={(e) => setMaxText(e.target.value)}
                />
              </div>
            )}
          </section>

          {crew.length === 0 ? null : plan.isError ? (
            <Callout tone="danger" title="No plan">
              {plan.error instanceof ApiError ? plan.error.message : 'Network error'}
            </Callout>
          ) : !result ? (
            <Skeleton height={120} />
          ) : (
            <section aria-label="Plan" className={styles.plan}>
              <Callout tone={tone} title={HEADLINE[result.reason]} role="status">
                {TEXT[result.reason]}
              </Callout>
              {result.steps.length > 0 && (
                <ol className={styles.steps}>
                  {result.steps.map((step, i) => (
                    <li
                      key={i}
                      className={styles.step}
                      data-direction={step.direction}
                      data-collapse={step.collapse}
                    >
                      <span className={styles.stepNo}>{i + 1}</span>
                      <span className={styles.stepShip}>
                        {step.direction === 'out' ? (
                          <ArrowRight aria-label="Out" />
                        ) : (
                          <ArrowLeft aria-label="Back" />
                        )}
                        {step.shipName}
                      </span>
                      <span className={styles.stepMode} data-mode={step.massMode}>
                        {step.massMode === 'hot' ? 'Hot' : 'Cold'}
                      </span>
                      <span className={styles.num}>{formatTonnes(step.mass)}</span>
                      <span className={styles.stepLeft}>
                        {step.collapse === 'will'
                          ? 'closed'
                          : `${formatRange(step.remainingAfter, formatTonnes)} left`}
                        {step.shows.length > 0 && step.collapse !== 'will' && (
                          <span className={styles.muted}>
                            {' '}
                            · shows {step.shows.map((s) => MASS_WORD[s].toLowerCase()).join(' or ')}
                          </span>
                        )}
                      </span>
                      <span className={styles.stepFlags}>
                        {collapseWord(step) && (
                          <span
                            className={styles.risk}
                            data-strand={step.direction === 'out' || undefined}
                            title={
                              step.direction === 'out'
                                ? 'This jump out may close the hole with the ship on the far side'
                                : 'This jump home may close the hole: that is the plan'
                            }
                          >
                            {step.direction === 'out' && <TriangleAlert aria-hidden />}
                            {collapseWord(step)}
                          </span>
                        )}
                        {step.polarized && (
                          <span className={styles.polarized} title="Same pilot, same way within five minutes">
                            <Hourglass aria-hidden />
                            wait 5m
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {remaining && result.crew.length > 0 && (
                <table className={styles.jumps}>
                  <caption>Jumps until</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ship</th>
                      {jumpsUntil(remaining, total, result.crew[0]!, result.maxJumpMass).map((j) => (
                        <th key={j.target} scope="col" colSpan={2}>
                          {j.target === 'half' ? 'Half' : j.target === 'critical' ? 'Critical' : 'Collapse'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.crew.map((ship) => (
                      <tr key={ship.shipTypeId}>
                        <th scope="row">{ship.name}</th>
                        {jumpsUntil(remaining, total, ship, result.maxJumpMass).flatMap((j) => [
                          <td key={`${j.target}c`} className={styles.num}>
                            {span(j.cold)} <span className={styles.muted}>cold</span>
                          </td>,
                          <td key={`${j.target}h`} className={styles.num}>
                            {span(j.hot)} <span className={styles.muted}>hot</span>
                          </td>,
                        ])}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function span(range: { min: number; max: number } | null): string {
  if (!range) return 'too heavy';
  if (range.max === 0) return 'done';
  return range.min === range.max ? String(range.max) : `${range.min}–${range.max}`;
}
