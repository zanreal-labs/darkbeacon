'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Calculator,
  ChevronDown,
  PiggyBank,
  Plus,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  HULL_CLASS_LABEL,
  MassStatus,
  TimeStatus,
  type ConnectionDto,
  type ConnectionIntelDto,
  type PassageDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import {
  Badge,
  Button,
  CharacterAvatar,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Select,
  Skeleton,
  useToast,
} from '../../ui';
import { PanelSection } from './PanelSection';
import { PanelShell } from './PanelShell';
import { DesignationPill } from '../widgets/SystemDetails';
import { useCollapsedSections } from '../widgets/storage';
import { eolRemaining, SHIP_SIZE_TEXT } from '../edgeStyle';
import type { MapStore } from '../useMapStore';
import { useConnectionIntel, usePassageCommands, usePassages } from './data';
import {
  formatAgo,
  formatDuration,
  formatRange,
  formatTonnes,
  MASS_MEANING,
  MASS_TOKEN,
  MASS_WORD,
  MODE_WORD,
} from './format';
import { TypeReferenceButton } from '../../reference/WormholeReferenceHost';
import { shipIcon } from './ShipPicker';
import sidebarStyles from '../widgets/widgets.module.css';
import styles from './connection.module.css';

type Store = Pick<MapStore, 'updateConnection'>;

interface Props {
  mapId: string;
  connection: ConnectionDto;
  names: { source: string; target: string };
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
  store: Store;
  /** The map merges others: passages live on its sources (polled, some read-only). */
  merged: boolean;
  open: boolean;
  onClose(): void;
  onSelectSystem(solarSystemId: number): void;
  onCover(cover: { right: number; bottom: number }): void;
  onLogJump(): void;
  onPlanRoll(): void;
  note?: ReactNode;
}

/** Re-renders every half minute, so time left counts down. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The connection's kind; a known wormhole type opens the wormhole types reference at it. */
function typeLine(c: ConnectionDto, intel: ConnectionIntelDto | undefined): ReactNode {
  if (c.type === 'gate') return 'Stargate';
  if (c.type === 'bridge') return 'Ansiblex jump bridge';
  const code = intel?.wormholeType;
  const guess = intel?.wormholeTypeFrom === 'static' ? ' (static, a guess)' : '';
  if (!code) return 'Wormhole, type unknown';
  return (
    <>
      Wormhole <TypeReferenceButton code={code}>{code}</TypeReferenceButton>
      {guess}
    </>
  );
}

/** The header: both ends (each selects its system), the type, and the states as words. */
function ConnectionIdentity({
  connection: c,
  intel,
  names,
  universe,
  now,
  onClose,
  onSelectSystem,
  handle,
}: {
  connection: ConnectionDto;
  intel: ConnectionIntelDto | undefined;
  names: { source: string; target: string };
  universe: Map<number, UniverseSystemDto>;
  now: number;
  onClose(): void;
  onSelectSystem(id: number): void;
  handle: ReactNode;
}) {
  const wormhole = c.type === 'wormhole';
  const eol = wormhole && c.timeStatus === 'eol' ? eolRemaining(c.eolAt, now) : null;
  const end = (id: number, name: string) => (
    <button type="button" className={styles.end} onClick={() => onSelectSystem(id)} title={`Select ${name}`}>
      <DesignationPill info={universe.get(id)} />
      <span className={styles.endName}>{name}</span>
    </button>
  );
  return (
    <header className={sidebarStyles.identity} data-identity>
      {handle}
      <div className={sidebarStyles.identityTop}>
        <h2 className={styles.ends}>
          {end(c.source, names.source)}
          <ArrowLeftRight aria-label="to" className={styles.between} />
          {end(c.target, names.target)}
        </h2>
        <span className={sidebarStyles.identityActions}>
          <IconButton size="sm" label="Close" tooltipSide="left" icon={<X />} onClick={onClose} />
        </span>
      </div>
      <p className={sidebarStyles.where}>
        <span className={sidebarStyles.space}>{typeLine(c, intel)}</span>
        {wormhole && (
          <>
            <span aria-hidden>·</span>
            <span>{SHIP_SIZE_TEXT[c.shipSize]}</span>
          </>
        )}
      </p>
      {wormhole && (
        <div className={styles.states}>
          <Badge
            dot
            color={MASS_TOKEN[c.massStatus]}
            title={`Mass ${MASS_WORD[c.massStatus].toLowerCase()}: ${MASS_MEANING[c.massStatus]}`}
          >
            {MASS_WORD[c.massStatus]}
          </Badge>
          {c.timeStatus === 'eol' ? (
            <Badge dot color={cssVar('edge-time-eol')} title="End of life: under 4 hours left">
              EOL{eol ? ` ${eol}` : ''}
            </Badge>
          ) : (
            <Badge variant="outline">Lifetime normal</Badge>
          )}
          {c.massSaved && (
            <Badge
              tone="warning"
              icon={<PiggyBank aria-hidden />}
              title="Someone saves its mass: do not roll it"
            >
              Mass saved
            </Badge>
          )}
          {c.dangerous && (
            <Badge tone="danger" icon={<TriangleAlert aria-hidden />}>
              Dangerous
            </Badge>
          )}
          {c.bubbled !== 'none' && (
            <Badge tone="warning">
              Bubbled{' '}
              {c.bubbled === 'both'
                ? 'both ends'
                : `at ${c.bubbled === 'source' ? names.source : names.target}`}
            </Badge>
          )}
        </div>
      )}
    </header>
  );
}

const MASS_OPTIONS = MassStatus.options.map((s) => ({
  value: s,
  label: `${MASS_WORD[s]} (${MASS_MEANING[s]})`,
  icon: <span className={sidebarStyles.statusDot} style={{ background: MASS_TOKEN[s] }} />,
}));
const TIME_OPTIONS = TimeStatus.options.map((s) => ({
  value: s,
  label: s === 'eol' ? 'End of life (under 4 h)' : 'Normal',
}));

/** Type, lifetime and the states people set, edited in place like the system details. */
function ConnectionDetails({
  connection: c,
  intel,
  can,
  store,
  now,
}: {
  connection: ConnectionDto;
  intel: ConnectionIntelDto | undefined;
  can: MapPermissions;
  store: Store;
  now: number;
}) {
  if (c.type !== 'wormhole')
    return (
      <p className={sidebarStyles.empty}>
        {c.type === 'gate'
          ? 'A stargate: no mass or lifetime to watch.'
          : 'A jump bridge: no mass or lifetime.'}
      </p>
    );
  const time = intel?.time;
  const left = time?.expiresBy ? Math.max(0, time.expiresBy - now) : null;
  const fits = intel?.fits.length ? intel.fits.map((h) => HULL_CLASS_LABEL[h]).at(-1) : null;
  return (
    <dl className={sidebarStyles.props}>
      <dt>Mass</dt>
      <dd>
        {can.edit ? (
          <Select
            size="sm"
            aria-label="Mass status"
            className={styles.select}
            value={c.massStatus}
            options={MASS_OPTIONS}
            onValueChange={(massStatus) =>
              void store.updateConnection(c.id, { massStatus: massStatus as MassStatus })
            }
          />
        ) : (
          `${MASS_WORD[c.massStatus]} (${MASS_MEANING[c.massStatus]})`
        )}
      </dd>
      <dt>Time</dt>
      <dd>
        {can.edit ? (
          <Select
            size="sm"
            aria-label="Time status"
            className={styles.select}
            value={c.timeStatus}
            options={TIME_OPTIONS}
            onValueChange={(timeStatus) =>
              void store.updateConnection(c.id, { timeStatus: timeStatus as TimeStatus })
            }
          />
        ) : c.timeStatus === 'eol' ? (
          'End of life'
        ) : (
          'Normal'
        )}
      </dd>
      <dt>Lifetime</dt>
      <dd className={styles.value}>
        {!intel ? (
          <Skeleton width={160} />
        ) : time?.lifetimeHours ? (
          <span>
            {time.lifetimeHours} h{' '}
            <span className={styles.muted}>{time.lifetimeFrom === 'class' ? 'by class' : 'by type'}</span>
            {left !== null && (
              <> · {left > 0 ? `gone in ${formatDuration(left)} at most` : 'should be gone'}</>
            )}
          </span>
        ) : (
          'Unknown'
        )}
      </dd>
      <dt>Per jump</dt>
      <dd className={styles.value}>
        {intel?.maxJumpMass ? (
          <span>
            {formatTonnes(intel.maxJumpMass)}
            {fits && <span className={styles.muted}> · fits {fits}</span>}
          </span>
        ) : (
          <span className={styles.muted}>{SHIP_SIZE_TEXT[c.shipSize]}</span>
        )}
      </dd>
    </dl>
  );
}

/**
 * The estimate as a bar: the hole's nominal total (with its ±10 %) as the track, what may be left
 * as the filled band, the 50 % and 10 % marks the game's statuses change at.
 */
function MassEstimate({
  connection: c,
  intel,
  onPlanRoll,
}: {
  connection: ConnectionDto;
  intel: ConnectionIntelDto | undefined;
  onPlanRoll(): void;
}) {
  if (!intel) return <Skeleton height={56} />;
  const m = intel.mass;
  if (c.type !== 'wormhole') return null;
  if (m.total === null || !m.range)
    return (
      <p className={sidebarStyles.empty}>
        The hole’s type is unknown, so its mass is too. Type its signature (not K162) to see what is left.
      </p>
    );
  const scale = m.total * 1.1;
  const pct = (kg: number) => `${Math.min(100, Math.max(0, (kg / scale) * 100))}%`;
  const since = m.since
    ? `since marked ${new Date(m.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : 'since it was found';
  return (
    <div className={styles.mass}>
      <div className={styles.massHead}>
        <span className={styles.massLeft}>{formatRange(m.range, formatTonnes)}</span>
        <span className={styles.muted}>left of {formatTonnes(m.total)} ±10 %</span>
      </div>
      <div
        className={styles.bar}
        role="img"
        aria-label={`Between ${formatTonnes(m.range.min)} and ${formatTonnes(m.range.max)} left of ${formatTonnes(m.total)}`}
      >
        <span
          className={styles.barBand}
          data-status={m.estimatedStatus ?? c.massStatus}
          style={{ left: pct(m.range.min), width: `calc(${pct(m.range.max)} - ${pct(m.range.min)})` }}
        />
        <span className={styles.barMark} style={{ left: pct(0.5 * m.total) }} title="50 %: reduced below" />
        <span className={styles.barMark} style={{ left: pct(0.1 * m.total) }} title="10 %: critical below" />
      </div>
      <p className={styles.massLine}>
        {m.passages === 0 ? (
          <>No jumps {since}.</>
        ) : (
          <>
            <strong>{formatTonnes(m.passed)}</strong> in {m.passages} jump{m.passages === 1 ? '' : 's'}{' '}
            {since}
            {m.unknownPassages > 0 && (
              <span className={styles.muted}>
                {' '}
                ({m.unknownPassages} ship{m.unknownPassages === 1 ? '' : 's'} unknown)
              </span>
            )}
            .
          </>
        )}
      </p>
      {m.regenerates && <p className={styles.muted}>Frigate holes regain their mass: they never run out.</p>}
      {m.overdrawn && (
        <p className={styles.warn}>
          <TriangleAlert aria-hidden /> More went through than “{MASS_WORD[c.massStatus].toLowerCase()}”
          allows. Set the mass as the hole shows it now.
        </p>
      )}
      {!m.regenerates && (
        <Button size="sm" icon={<Calculator />} onClick={onPlanRoll}>
          Plan a roll
        </Button>
      )}
    </div>
  );
}

/** One passage: ship, way, pilot or "by hand", when, mass and how it counted. */
function PassageRow({
  passage: p,
  names,
  now,
  editable,
  onMode,
  onCustom,
  onRemove,
}: {
  passage: PassageDto;
  names: Map<number, string>;
  now: number;
  editable: boolean;
  onMode(mode: 'cold' | 'hot'): void;
  onCustom(): void;
  onRemove(): void;
}) {
  const mode = p.massMode ?? 'cold';
  const to = names.get(p.to) ?? 'the other side';
  const who =
    p.source === 'manual' ? (
      <span>Logged by hand</span>
    ) : p.characterId ? (
      <span className={styles.pilot}>
        <CharacterAvatar id={p.characterId} name={p.characterName ?? 'Pilot'} size={16} />
        {p.characterName ?? 'A tracked pilot'}
      </span>
    ) : (
      <span>A tracked pilot</span>
    );
  const modeLabel = [
    MODE_WORD[mode],
    ...(p.higgs ? ['Higgs'] : []),
    ...(p.entangler ? ['entangler'] : []),
  ].join(' + ');
  return (
    <li className={styles.passage} data-counted={p.counted !== false || undefined}>
      {p.shipTypeId !== null ? (
        <img className={styles.passageShip} src={shipIcon(p.shipTypeId)} alt="" width={24} height={24} />
      ) : (
        <span className={styles.passageShip} aria-hidden />
      )}
      <div className={styles.passageMain}>
        <div className={styles.passageTitle}>
          <span className={styles.ellipsis}>{p.shipName ?? 'Ship unknown'}</span>
          <span className={styles.muted}>
            <ArrowRight aria-label="to" className={styles.inlineIcon} />
            {to}
          </span>
        </div>
        <div className={styles.passageMeta}>
          {who}
          <span aria-hidden>·</span>
          <time dateTime={new Date(p.occurredAt).toISOString()}>{formatAgo(p.occurredAt, now)}</time>
          {p.recordedOn && <span>· on {p.recordedOn}</span>}
          {p.note && <span className={styles.ellipsis}>· {p.note}</span>}
        </div>
      </div>
      <div className={styles.passageMass}>
        <span className={styles.num}>{p.mass === null ? '—' : formatTonnes(p.mass)}</span>
        {editable ? (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className={styles.modeButton}
                data-mode={mode}
                aria-label={`Counted ${modeLabel}: change`}
              >
                {modeLabel}
                <ChevronDown aria-hidden />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Count this jump</MenuLabel>
              <MenuItem disabled={p.shipTypeId === null} onSelect={() => onMode('cold')}>
                Cold: prop module off
              </MenuItem>
              <MenuItem disabled={p.shipTypeId === null} onSelect={() => onMode('hot')}>
                Hot: prop module running
              </MenuItem>
              <MenuItem onSelect={onCustom}>Custom mass…</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={onRemove}>
                Delete…
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : (
          <span className={styles.modeText} data-mode={mode}>
            {modeLabel}
          </span>
        )}
      </div>
    </li>
  );
}

function CustomMassDialog({
  passage,
  onClose,
  onSave,
}: {
  passage: PassageDto | null;
  onClose(): void;
  onSave(kg: number): Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const kg = Number(text.replace(/\s/g, '')) * 1000;
  const valid = Number.isFinite(kg) && kg > 0;
  return (
    <Dialog
      open={passage !== null}
      onOpenChange={(open) => {
        if (!open) {
          setText('');
          onClose();
        }
      }}
    >
      <DialogContent
        title="Custom mass"
        description={
          passage
            ? `What ${passage.shipName ?? 'the ship'} weighed when it jumped: plates and all.`
            : undefined
        }
        width={400}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!valid}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave(kg);
                  setText('');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Mass in tonnes">
          <Input
            autoFocus
            inputMode="numeric"
            value={text}
            placeholder={passage?.mass ? String(Math.round(passage.mass / 1000)) : 'e.g. 250000'}
            trailing="t"
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The passage log: newest first; jumps from before the mass was last marked (or the counter
 * reset) stay in the list but no longer count. Members change how a jump counts and delete
 * mistakes; on a merged map only this map's own jumps can be changed.
 */
function PassageList({
  mapId,
  connection,
  passages,
  names,
  can,
  merged,
  now,
}: {
  mapId: string;
  connection: ConnectionDto;
  passages: PassageDto[] | undefined;
  names: Map<number, string>;
  can: MapPermissions;
  merged: boolean;
  now: number;
}) {
  const toast = useToast();
  const commands = usePassageCommands(mapId, connection.id);
  const [custom, setCustom] = useState<PassageDto | null>(null);
  const [removing, setRemoving] = useState<PassageDto | null>(null);
  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: e instanceof ApiError ? e.message : 'Network error', tone: 'danger' });

  if (!passages) return <Skeleton height={48} />;
  if (passages.length === 0)
    return (
      <p className={sidebarStyles.empty}>
        No jumps yet. Tracked pilots are recorded as they jump{can.edit ? '; log the others by hand.' : '.'}
      </p>
    );
  const firstOld = passages.findIndex((p) => p.counted === false);
  return (
    <>
      <ul className={styles.passages}>
        {passages.map((p, i) => (
          <PassageRowWithDivider
            key={p.id}
            divider={i === firstOld}
            passage={p}
            names={names}
            now={now}
            editable={can.edit && !p.recordedOn && !(merged && p.id.startsWith('m:'))}
            onMode={(massMode) =>
              commands.update.mutateAsync({ passageId: p.id, body: { massMode } }).catch(fail('Not changed'))
            }
            onCustom={() => setCustom(p)}
            onRemove={() => setRemoving(p)}
          />
        ))}
      </ul>
      <CustomMassDialog
        passage={custom}
        onClose={() => setCustom(null)}
        onSave={(mass) =>
          commands.update
            .mutateAsync({ passageId: custom!.id, body: { massMode: 'custom', mass } })
            .then(() => setCustom(null), fail('Not changed'))
        }
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this jump?"
        description={`${removing?.shipName ?? 'The jump'} no longer counts towards the mass. The history keeps it.`}
        confirmLabel="Delete jump"
        tone="danger"
        onConfirm={() => commands.remove.mutateAsync(removing!.id).catch(fail('Not deleted'))}
      />
    </>
  );
}

function PassageRowWithDivider({
  divider,
  ...props
}: Parameters<typeof PassageRow>[0] & { divider: boolean }) {
  return (
    <>
      {divider && (
        <li className={styles.divider} role="separator">
          Before the mass was marked: not counted
        </li>
      )}
      <PassageRow {...props} />
    </>
  );
}

/**
 * The selected connection in the map's sidebar shell: header with both ends and the states as
 * words, then Connection (type, lifetime, the states people set), Mass (the estimate as a range
 * and a bar, Plan a roll; Reset counter) and Passages (the log; Log a jump).
 */
export function ConnectionSidebar({
  mapId,
  connection,
  names,
  universe,
  can,
  store,
  merged,
  open,
  onClose,
  onSelectSystem,
  onCover,
  onLogJump,
  onPlanRoll,
  note,
}: Props) {
  const now = useNow();
  const toast = useToast();
  const { collapsed, toggle } = useCollapsedSections();
  const intel = useConnectionIntel(mapId, connection.id, merged);
  const passages = usePassages(mapId, connection.id, merged);
  const commands = usePassageCommands(mapId, connection.id);
  const wormhole = connection.type === 'wormhole';
  const nameOf = new Map([
    [connection.source, names.source],
    [connection.target, names.target],
  ]);

  return (
    <PanelShell
      label="Connection"
      open={open}
      resetKey={connection.id}
      onCover={onCover}
      note={note}
      header={(handle) => (
        <ConnectionIdentity
          connection={connection}
          intel={intel.data}
          names={names}
          universe={universe}
          now={now}
          onClose={onClose}
          onSelectSystem={onSelectSystem}
          handle={handle}
        />
      )}
    >
      <PanelSection id="connection" title="Connection" collapsed={!!collapsed.connection} onToggle={toggle}>
        <ConnectionDetails connection={connection} intel={intel.data} can={can} store={store} now={now} />
      </PanelSection>
      {wormhole && (
        <PanelSection
          id="mass"
          title="Mass"
          collapsed={!!collapsed.mass}
          onToggle={toggle}
          action={
            can.edit && (
              <IconButton
                size="sm"
                label="Reset counter: count jumps from now"
                tooltipSide="left"
                icon={<RotateCcw />}
                loading={commands.reset.isPending}
                onClick={() =>
                  commands.reset.mutateAsync().then(
                    () =>
                      toast({
                        title: 'Counter reset',
                        description: 'Jumps count from now.',
                        tone: 'success',
                      }),
                    (e: unknown) =>
                      toast({
                        title: 'Counter not reset',
                        description: e instanceof ApiError ? e.message : 'Network error',
                        tone: 'danger',
                      }),
                  )
                }
              />
            )
          }
        >
          <MassEstimate connection={connection} intel={intel.data} onPlanRoll={onPlanRoll} />
        </PanelSection>
      )}
      <PanelSection
        id="passages"
        title="Passages"
        count={passages.data?.length}
        collapsed={!!collapsed.passages}
        onToggle={toggle}
        action={
          can.edit &&
          wormhole && (
            <IconButton size="sm" label="Log a jump" tooltipSide="left" icon={<Plus />} onClick={onLogJump} />
          )
        }
      >
        <PassageList
          mapId={mapId}
          connection={connection}
          passages={passages.data}
          names={nameOf}
          can={can}
          merged={merged}
          now={now}
        />
      </PanelSection>
    </PanelShell>
  );
}
