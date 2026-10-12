'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  jumpMass,
  type ConnectionDto,
  type FitMassDto,
  type MassMode,
  type PassageDirection,
} from '@darkbeacon/shared';
import { ApiError } from '../../lib/api';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  Input,
  Segmented,
  useToast,
} from '../../ui';
import { usePassageCommands, useShipCatalog } from './data';
import { FitPaste } from './FitPaste';
import { formatTonnes } from './format';
import { ShipPicker, type ShipOption } from './ShipPicker';
import styles from './connection.module.css';

/**
 * "Log a jump" for pilots nobody tracks: the ship (by name), which way, how its mass counted
 * (cold, hot with the prop module running, or a mass someone knows), how many times. Warns when
 * the ship is too heavy for the hole.
 */
export function LogJumpDialog({
  open,
  onOpenChange,
  mapId,
  connection,
  names,
  maxJumpMass,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  mapId: string;
  connection: ConnectionDto;
  names: { source: string; target: string };
  maxJumpMass: number | null;
}) {
  const toast = useToast();
  const catalog = useShipCatalog();
  const commands = usePassageCommands(mapId, connection.id);
  const [ship, setShip] = useState<ShipOption | null>(null);
  const [direction, setDirection] = useState<PassageDirection>('sourceToTarget');
  const [mode, setMode] = useState<MassMode>('cold');
  const [higgs, setHiggs] = useState(false);
  const [entangler, setEntangler] = useState(false);
  const [customTonnes, setCustomTonnes] = useState('');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('');
  const [byFit, setByFit] = useState(false);
  const [fit, setFit] = useState<{ text: string; mass: FitMassDto } | null>(null);

  const weighed = byFit ? fit?.mass : undefined;
  const facts = weighed ? weighed.ship : byFit ? undefined : ship?.ship;
  const custom = Number(customTonnes.replace(/\s/g, '')) * 1000;
  const times = Math.min(20, Math.max(1, Math.round(Number(count)) || 1));
  const mass = weighed
    ? mode === 'custom'
      ? Number.isFinite(custom) && custom > 0
        ? custom
        : null
      : mode === 'hot'
        ? weighed.hot
        : weighed.cold
    : catalog.data && (facts || mode === 'custom')
      ? jumpMass(
          facts,
          {
            massMode: mode,
            higgs: higgs && !!facts?.higgs,
            entangler: entangler && !!facts?.entangler,
            mass: Number.isFinite(custom) && custom > 0 ? custom : null,
          },
          catalog.data.modifiers,
        )
      : null;
  const tooHeavy = mass !== null && maxJumpMass !== null && mass > maxJumpMass;
  const ready = !!facts && mass !== null;

  const reset = () => {
    setShip(null);
    setMode('cold');
    setHiggs(false);
    setEntangler(false);
    setCustomTonnes('');
    setCount('1');
    setNote('');
    setByFit(false);
    setFit(null);
  };

  const submit = async () => {
    if (!facts || mass === null) return;
    try {
      // A fit's weight is its own (plates and all): it goes in as a custom mass, named in the note.
      const fitNote = weighed
        ? `${mode === 'hot' ? 'Hot' : 'Cold'} fit${weighed.name ? ` ${weighed.name}` : ''}`
        : '';
      const text = [fitNote, note.trim()].filter(Boolean).join(' · ');
      await commands.log.mutateAsync({
        shipTypeId: facts.id,
        direction,
        massMode: weighed ? 'custom' : mode,
        ...(weighed || mode === 'custom' ? { mass } : {}),
        ...(!weighed && mode !== 'custom' && higgs && facts.higgs ? { higgs: true } : {}),
        ...(!weighed && mode !== 'custom' && entangler && facts.entangler ? { entangler: true } : {}),
        ...(text ? { note: text.slice(0, 200) } : {}),
        count: times,
      });
      toast({
        title: times > 1 ? `Logged ${times} jumps` : 'Jump logged',
        description: `${facts.name}, ${formatTonnes(mass * times)} on the hole.`,
        tone: 'success',
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Jump not logged',
        description: e instanceof ApiError ? e.message : 'Network error',
        tone: 'danger',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Log a jump"
        description="For pilots nobody tracks here. It counts towards the mass estimate like a tracked jump."
        width={520}
        footer={
          <>
            {mass !== null && ready && (
              <span className={styles.footerNote}>
                {formatTonnes(mass)}
                {times > 1 ? ` × ${times} = ${formatTonnes(mass * times)}` : ''}
              </span>
            )}
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!ready}
              loading={commands.log.isPending}
              onClick={() => void submit()}
            >
              {times > 1 ? `Log ${times} jumps` : 'Log jump'}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          {byFit ? (
            <FitPaste onWeighed={setFit} />
          ) : (
            <Field label="Ship">
              <ShipPicker value={ship} onChange={setShip} suggested={catalog.data?.suggested} />
            </Field>
          )}
          <Button
            size="sm"
            variant="ghost"
            className={styles.switchSource}
            onClick={() => {
              setByFit((b) => !b);
              setFit(null);
            }}
          >
            {byFit ? 'Pick a ship instead' : 'Weigh a pasted fit instead (plates and all)'}
          </Button>
          <Field label="Direction">
            <Segmented
              aria-label="Direction"
              value={direction}
              onValueChange={(v) => setDirection(v as PassageDirection)}
              options={[
                {
                  value: 'sourceToTarget',
                  label: (
                    <span className={styles.direction}>
                      {names.source} <ArrowRight aria-hidden /> {names.target}
                    </span>
                  ),
                },
                {
                  value: 'targetToSource',
                  label: (
                    <span className={styles.direction}>
                      {names.target} <ArrowRight aria-hidden /> {names.source}
                    </span>
                  ),
                },
              ]}
            />
          </Field>
          <Field
            label="Mass"
            hint={
              weighed && mode !== 'custom'
                ? `The fit ${mode}: ${formatTonnes(mode === 'hot' ? weighed.hot : weighed.cold)}`
                : mode === 'hot'
                  ? facts?.propMass
                    ? `Prop module running: +${formatTonnes(facts.propMass)}`
                    : 'This ship has no prop module slot: hot is the hull'
                  : mode === 'cold'
                    ? 'The hull, prop module off'
                    : 'What the ship weighed, plates and all'
            }
          >
            <Segmented
              aria-label="Mass"
              value={mode}
              onValueChange={(v) => setMode(v as MassMode)}
              options={[
                { value: 'cold', label: 'Cold' },
                { value: 'hot', label: 'Hot' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </Field>
          {mode === 'custom' ? (
            <Field label="Mass in tonnes">
              <Input
                inputMode="numeric"
                value={customTonnes}
                placeholder="e.g. 250000"
                trailing="t"
                onChange={(e) => setCustomTonnes(e.target.value)}
              />
            </Field>
          ) : (
            !weighed &&
            (facts?.higgs || facts?.entangler) && (
              <div className={styles.checks}>
                {facts.higgs && (
                  <Checkbox
                    checked={higgs}
                    onCheckedChange={(on) => setHiggs(on === true)}
                    label="Higgs Anchor"
                    description="Doubles the mass"
                  />
                )}
                {facts.entangler && (
                  <Checkbox
                    checked={entangler}
                    onCheckedChange={(on) => setEntangler(on === true)}
                    label="Mass entangler on"
                    description="A fifth of the mass"
                  />
                )}
              </div>
            )
          )}
          <div className={styles.row2}>
            <Field label="Jumps">
              <Input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
            <Field label="Note" optional>
              <Input
                value={note}
                maxLength={200}
                placeholder="Who flew it, plates…"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          {tooHeavy && (
            <Callout tone="warning" title="Too heavy for this hole">
              It lets at most {formatTonnes(maxJumpMass)} through in one jump; this ship weighs{' '}
              {formatTonnes(mass)}.
            </Callout>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
