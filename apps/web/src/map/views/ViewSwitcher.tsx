'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Globe,
  LayoutTemplate,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { VIEW_NAME_MAX, VIEW_SLOTS, type ViewSlot } from '@darkbeacon/shared';
import { ApiError } from '../../lib/api';
import { track } from '../../lib/telemetry';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Select,
  Tooltip,
  useToast,
} from '../../ui';
import { BUILT_IN_VIEWS, type NamedView, type ViewPreset, type ViewRef } from './format';
import type { ViewsController } from './useViews';
import styles from './views.module.css';

/** Keys typed into a field are text, not shortcuts. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** Alt+1, Alt+2, Alt+3 by the key's place (on a Mac, Option+1 types "¡"), or null. */
export function slotKey(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const match = /^(?:Digit|Numpad)([123])$/.exec(e.code);
  return match ? (Number(match[1]) as ViewSlot) : null;
}

/** Alt+1/2/3 apply the quick slots, anywhere on the map but in a text field. */
function useSlotKeys(views: ViewsController) {
  const { applySlot } = views;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return;
      const slot = slotKey(e);
      if (slot === null) return;
      e.preventDefault();
      track('shortcut_used', { shortcut: 'view_slot' });
      applySlot(slot);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applySlot]);
}

const SOURCE_NAME = { personal: 'Yours', map: 'Map', builtin: 'Built in' } as const;

type Naming =
  | { kind: 'save' }
  | { kind: 'rename'; ref: ViewRef; name: string }
  | { kind: 'publish'; name: string; view: ViewPreset };

/**
 * The map's saved views in its top bar: quick slots 1, 2 and 3 (Alt+1/2/3, the one on screen
 * highlighted) and the Views menu next to them: apply, save the screen as a view, pin one to a
 * slot, rename, overwrite, delete, publish to the map (managers) and back to the map's defaults.
 * On phones the slots fold into the menu's button.
 */
export function ViewSwitcher({ views, compact = false }: { views: ViewsController; compact?: boolean }) {
  const toast = useToast();
  const [naming, setNaming] = useState<Naming | null>(null);
  const [removing, setRemoving] = useState<NamedView | null>(null);
  useSlotKeys(views);

  const done = (title: string) => () => toast({ title, tone: 'success', duration: 2000 });
  const failed = (title: string) => (error: unknown) =>
    toast({
      title,
      description: error instanceof ApiError ? error.message : 'Network error',
      tone: 'danger',
    });
  const run = (work: Promise<unknown>, ok: string, fail: string) => void work.then(done(ok), failed(fail));

  const slotOf = (v: NamedView) =>
    views.slots.find((s) => s.view.source === v.source && s.view.id === v.id)?.slot;

  const viewItems = (v: NamedView) => {
    const ref: ViewRef = { source: v.source, id: v.id };
    const managed = v.source === 'map' && views.canPublish;
    const shown = slotOf(v);
    return (
      <MenuSub key={`${v.source}:${v.id}`}>
        <MenuSubTrigger
          icon={
            shown ? (
              <span className={styles.menuSlot}>{shown}</span>
            ) : (
              <span className={styles.menuSlotEmpty} />
            )
          }
        >
          <span className={styles.menuName}>{v.name}</span>
          {v.source === 'map' && <span className={styles.mapMark}>Map</span>}
        </MenuSubTrigger>
        <MenuSubContent className={styles.sub}>
          <MenuItem icon={<Check />} onSelect={() => views.apply(v)}>
            Apply
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger icon={<Pin />}>Pin to slot</MenuSubTrigger>
            <MenuSubContent>
              {VIEW_SLOTS.map((slot) => (
                <MenuItem
                  key={slot}
                  shortcut={`Alt+${slot}`}
                  onSelect={() => run(views.pin(slot, ref), `${v.name} is on slot ${slot}`, 'Not pinned')}
                >
                  Slot {slot}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          {(v.source === 'personal' || managed) && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Save />}
                onSelect={() => run(views.overwrite(ref), `${v.name} saved`, 'The view did not change')}
              >
                Save the screen into it
              </MenuItem>
              <MenuItem icon={<Pencil />} onSelect={() => setNaming({ kind: 'rename', ref, name: v.name })}>
                Rename…
              </MenuItem>
            </>
          )}
          {v.source === 'personal' && views.canPublish && (
            <MenuItem
              icon={<Upload />}
              onSelect={() => setNaming({ kind: 'publish', name: v.name, view: v.view })}
            >
              Publish to the map…
            </MenuItem>
          )}
          {managed && (
            <MenuSub>
              <MenuSubTrigger icon={<Globe />}>Default slot for everyone</MenuSubTrigger>
              <MenuSubContent>
                <MenuRadioGroup
                  value={v.slot ? String(v.slot) : 'none'}
                  onValueChange={(value) =>
                    run(
                      views.setMapSlot(v.id, value === 'none' ? undefined : (Number(value) as ViewSlot)),
                      value === 'none' ? `${v.name} is on no slot` : `${v.name} is everyone's slot ${value}`,
                      'The slot did not change',
                    )
                  }
                >
                  <MenuRadioItem value="none">None</MenuRadioItem>
                  {VIEW_SLOTS.map((slot) => (
                    <MenuRadioItem key={slot} value={String(slot)}>
                      Slot {slot}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
          )}
          {(v.source === 'personal' || managed) && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 />}
                tone="danger"
                onSelect={() =>
                  v.source === 'map'
                    ? setRemoving(v)
                    : run(views.remove(ref), `${v.name} deleted`, 'Not deleted')
                }
              >
                {v.source === 'map' ? 'Delete from the map…' : 'Delete'}
              </MenuItem>
            </>
          )}
        </MenuSubContent>
      </MenuSub>
    );
  };

  const active = views.slots.find((s) => s.slot === views.active);
  const menu = (
    <Menu>
      <Tooltip content="Saved views of the map screen">
        <MenuTrigger asChild>
          <button
            type="button"
            className={styles.menuButton}
            aria-label={compact && active ? `Views: ${active.view.name} on slot ${active.slot}` : 'Views'}
          >
            {compact && active ? (
              <span className={styles.compactSlot}>{active.slot}</span>
            ) : (
              <LayoutTemplate aria-hidden />
            )}
          </button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className={styles.menu}>
        <MenuLabel>Quick slots</MenuLabel>
        {views.slots.map((s) => (
          <MenuItem
            key={s.slot}
            icon={
              <span className={styles.menuSlot} data-active={s.slot === views.active || undefined}>
                {s.slot}
              </span>
            }
            shortcut={`Alt+${s.slot}`}
            onSelect={() => views.apply(s.view)}
          >
            <span className={styles.menuName}>{s.view.name}</span>
            <span className={styles.slotSource}>
              {s.pinned ? 'Pinned by you' : SOURCE_NAME[s.view.source]}
            </span>
          </MenuItem>
        ))}
        {views.personal.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Your views</MenuLabel>
            {views.personal.map(viewItems)}
          </>
        )}
        {views.published.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>This map’s views</MenuLabel>
            {views.published.map(viewItems)}
          </>
        )}
        <MenuSeparator />
        <MenuLabel>Built in</MenuLabel>
        {BUILT_IN_VIEWS.map(viewItems)}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => setNaming({ kind: 'save' })}>
          Save the screen as a view…
        </MenuItem>
        {views.hasPins && (
          <MenuItem
            icon={<RotateCcw />}
            onSelect={() => run(views.resetPins(), 'Slots are the map’s again', 'The slots did not change')}
          >
            Reset slots to the map’s defaults
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );

  return (
    <div className={styles.bar} data-compact={compact || undefined}>
      {!compact && (
        <div className={styles.slots} role="group" aria-label="Quick views">
          {views.slots.map((s) => (
            <Tooltip
              key={s.slot}
              content={`${s.view.name} · Alt+${s.slot}${s.pinned ? ' · pinned by you' : ''}`}
            >
              <button
                type="button"
                className={styles.slot}
                aria-pressed={s.slot === views.active}
                aria-label={`View ${s.slot}: ${s.view.name}${s.slot === views.active && views.modified ? ', changed since' : ''}`}
                data-modified={(s.slot === views.active && views.modified) || undefined}
                onClick={() => views.applySlot(s.slot)}
              >
                {s.slot}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
      {menu}
      {naming && (
        <NameDialog
          naming={naming}
          canPublish={views.canPublish}
          onClose={() => setNaming(null)}
          onSubmit={async (name, publish, slot) => {
            if (naming.kind === 'rename') {
              await views.rename(naming.ref, name);
              done(`Renamed to ${name}`)();
            } else if (naming.kind === 'publish') {
              await views.publish(name, naming.view, slot);
              done(`${name} is on the map for everyone`)();
            } else if (publish) {
              await views.publish(name, views.current(), slot);
              done(`${name} is on the map for everyone`)();
            } else {
              await views.saveAs(name);
              done(`${name} saved`)();
            }
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'the view'} from the map?`}
        description="Everyone on the map loses it; slots that showed it go back to the defaults."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() =>
          removing &&
          views
            .remove({ source: 'map', id: removing.id })
            .then(done(`${removing.name} deleted`), failed('Not deleted'))
        }
      />
    </div>
  );
}

const SLOT_OPTIONS = [
  { value: 'none', label: 'No slot' },
  ...VIEW_SLOTS.map((s) => ({ value: String(s), label: `Slot ${s} (Alt+${s})` })),
];

/** Names a view: save the screen as one, rename one, publish one to the map with its slot. */
function NameDialog({
  naming,
  canPublish,
  onClose,
  onSubmit,
}: {
  naming: Naming;
  canPublish: boolean;
  onClose(): void;
  onSubmit(name: string, publish: boolean, slot: ViewSlot | undefined): Promise<void>;
}) {
  const [name, setName] = useState(naming.kind === 'save' ? '' : naming.name);
  const [publish, setPublish] = useState(naming.kind === 'publish');
  const [slot, setSlot] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishing = naming.kind === 'publish' || (naming.kind === 'save' && publish);
  const title =
    naming.kind === 'rename'
      ? 'Rename the view'
      : naming.kind === 'publish'
        ? 'Publish to the map'
        : 'Save the screen as a view';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give it a name.');
    setBusy(true);
    try {
      await onSubmit(trimmed, publishing, slot === 'none' ? undefined : (Number(slot) as ViewSlot));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={title}
        description={
          publishing
            ? 'Everyone on the map gets it at once; on a slot, it is their default there.'
            : naming.kind === 'save'
              ? 'The widgets, where they are and the minimap and background, under one name.'
              : undefined
        }
        width={420}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" type="submit" form="view-name" loading={busy}>
              {publishing ? 'Publish' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="view-name" className={styles.form} onSubmit={(e) => void submit(e)}>
          <Field label="Name" error={error ?? undefined}>
            <Input
              autoFocus
              value={name}
              maxLength={VIEW_NAME_MAX}
              placeholder="Scan, Fleet, Rolling…"
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </Field>
          {naming.kind === 'save' && canPublish && (
            <Checkbox
              checked={publish}
              onCheckedChange={setPublish}
              label="Publish to the map for everyone"
              description="Map managers decide the map’s views; members may still pin their own."
            />
          )}
          {publishing && (
            <Field label="Everyone’s quick slot" hint="It replaces the map’s view on that slot.">
              <Select value={slot} onValueChange={setSlot} options={SLOT_OPTIONS} />
            </Field>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
