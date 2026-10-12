'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ClipboardPaste } from 'lucide-react';
import type { CharacterDto, LabelDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
import { SlotItem } from '../../plugins/PluginSlot';
import type { SlotEntry } from '../../plugins/registry';
import { IconButton } from '../../ui';
import type { MapState } from '../mapState';
import type { MapStore } from '../useMapStore';
import { LocalSection, TrackMenu, usePresence } from './LocalSection';
import { SidebarSection } from './SidebarSection';
import {
  canReadClipboard,
  looksLikeScanner,
  pasteFromClipboard,
  SignaturesSection,
  useSignaturePaste,
} from './SignaturesSection';
import { readStored, usePhone, WIDTH_KEY, writeStored, useCollapsedSections } from './storage';
import { CommentsSection } from './CommentsSection';
import { HistorySection } from './HistorySection';
import { StructuresSection } from './StructuresSection';
import { SignatureSettingsMenu } from '../signatures/SignatureSettingsMenu';
import { systemDisplayName } from '../SystemNode';
import { SetDestination, SystemDetails, SystemIdentity } from './SystemDetails';
import styles from './sidebar.module.css';

export const SIDEBAR_WIDTH = { default: 380, min: 320, max: 640 };

const isWidth = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampWidth = (w: number) =>
  Math.round(
    Math.min(
      Math.max(w, SIDEBAR_WIDTH.min),
      Math.min(SIDEBAR_WIDTH.max, typeof window === 'undefined' ? Infinity : window.innerWidth - 240),
    ),
  );

/** The sidebar's remembered width, with a setter that keeps it in bounds and stores it. */
export function useSidebarWidth() {
  const [width, setWidthState] = useState(() =>
    clampWidth(
      (typeof window === 'undefined' ? null : readStored(WIDTH_KEY, isWidth)) ?? SIDEBAR_WIDTH.default,
    ),
  );
  const setWidth = useCallback((w: number, persist = true) => {
    const next = clampWidth(w);
    setWidthState(next);
    if (persist) writeStored(WIDTH_KEY, next);
  }, []);
  return [width, setWidth] as const;
}

/**
 * Phone sheet stops: just the system's header (`peek`, its measured height), half the map, all of
 * it below the map's top bar.
 */
export type SheetStop = 'peek' | 'half' | 'full';
export function sheetHeight(stop: SheetStop, room: number, peek: number): number {
  if (stop === 'peek') return Math.min(peek, room);
  if (stop === 'half') return Math.max(peek, Math.round(room * 0.5));
  return Math.max(peek, room - 56);
}
const NEXT_STOP: Record<SheetStop, SheetStop> = { peek: 'half', half: 'full', full: 'peek' };

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface Props {
  mapId: string;
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  universe: Map<number, UniverseSystemDto>;
  labels: LabelDto[];
  state: Pick<MapState, 'signatures' | 'connections' | 'characters' | 'has'> &
    Partial<Pick<MapState, 'systems'>>;
  can: MapPermissions;
  store: Pick<MapStore, 'updateSystem' | 'pasteSignatures' | 'updateSignature' | 'removeSignature' | 'seed'>;
  myCharacters: CharacterDto[];
  plugins: readonly SlotEntry<'widget'>[];
  /** Shown, or hidden with the top bar's toggle while the system stays selected. */
  open: boolean;
  /** Bumped to show the details and focus the name field. */
  focusToken: number;
  /** Clears the selection (the close button). */
  onClose(): void;
  onSelectSystem(solarSystemId: number): void;
  /** Pixels of the canvas the sidebar covers: its width on wide screens, the sheet on phones. */
  onCover(cover: { right: number; bottom: number }): void;
  /** One quiet line under the header (where a merged system comes from). */
  note?: ReactNode;
}

/**
 * Everything about the selected system at once: header, signatures, local and plugin widgets,
 * each section folding on its own. Docked to the right on wide screens (resizable), a bottom
 * sheet with peek, half and full stops on phones. Ctrl+V anywhere outside a text field pastes
 * probe scanner results into the selected system.
 */
export function SystemSidebar({
  mapId,
  system,
  info,
  universe,
  labels,
  state,
  can,
  store,
  myCharacters,
  plugins,
  open,
  focusToken,
  onClose,
  onSelectSystem,
  onCover,
  note,
}: Props) {
  const phone = usePhone();
  const [width, setWidth] = useSidebarWidth();
  const [stop, setStop] = useState<SheetStop>('peek');
  const [drag, setDrag] = useState<number | null>(null);
  const [box, setBox] = useState({ room: 0, peek: 120 });
  const heightAt = (at: SheetStop) => sheetHeight(at, box.room, box.peek);
  const rootRef = useRef<HTMLElement>(null);
  const { collapsed, toggle, expand } = useCollapsedSections();
  const id = system.solarSystemId;

  const paste = useSignaturePaste(id, store);
  const presence = usePresence(mapId, store);

  // Ctrl+V on the map or in the sidebar, but never into a field someone is typing in.
  useEffect(() => {
    if (!can.edit) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || editable(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!looksLikeScanner(text)) return;
      e.preventDefault();
      void paste.submit(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [can.edit, paste]);

  // The context menu's "Edit" opens the details (and focuses the name, once).
  const focusedRef = useRef(0);
  useEffect(() => {
    if (focusToken > 0) expand('system');
  }, [focusToken, expand]);

  // A new selection on a phone starts at the peek stop.
  const [seenSystem, setSeenSystem] = useState(id);
  if (seenSystem !== id) {
    setSeenSystem(id);
    if (stop !== 'peek') setStop('peek');
  }

  // The room the sheet has (the map's height) and its header's height, for the stops.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    const identity = root?.querySelector<HTMLElement>('[data-identity]');
    if (!parent || !identity) return;
    const measure = () => {
      const next = { room: parent.clientHeight, peek: identity.offsetHeight + 1 };
      setBox((b) => (b.room === next.room && b.peek === next.peek ? b : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    observer?.observe(identity);
    return () => observer?.disconnect();
  }, [phone]);

  const settled = heightAt(stop);
  const sheet = drag ?? settled;
  useEffect(() => {
    if (!open) onCover({ right: 0, bottom: 0 });
    else if (phone) onCover({ right: 0, bottom: settled });
    else onCover({ right: width, bottom: 0 });
  }, [open, phone, width, settled, onCover]);

  // Resizing from the left edge.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    let last = startWidth;
    const move = (ev: PointerEvent) => {
      last = startWidth + (startX - ev.clientX);
      setWidth(last, false);
    };
    const up = () => {
      setWidth(last);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const resizeKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') setWidth(width + step);
    else if (e.key === 'ArrowRight') setWidth(width - step);
    else return;
    e.preventDefault();
  };

  // The sheet's handle: drag to any height, let go at the nearest stop; a tap goes to the next.
  const startSheetDrag = (e: ReactPointerEvent) => {
    const startY = e.clientY;
    const startHeight = heightAt(stop);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    let moved = false;
    let height = startHeight;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 4) moved = true;
      if (!moved) return;
      height = Math.min(Math.max(startHeight + (startY - ev.clientY), 96), heightAt('full'));
      setDrag(height);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) return setStop((s) => NEXT_STOP[s]);
      const stops: SheetStop[] = ['peek', 'half', 'full'];
      setStop(
        stops.reduce((best, s) =>
          Math.abs(heightAt(s) - height) < Math.abs(heightAt(best) - height) ? s : best,
        ),
      );
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const signatures = [...state.signatures.values()].filter((s) => s.solarSystemId === id);
  const here = [...state.characters.values()].filter((c) => c.solarSystemId === id);
  const mine = new Set(myCharacters.map((c) => c.id));
  const tracked = new Set([...state.characters.values()].map((c) => c.characterId));
  const name = info?.name ?? 'this system';
  const systemName = (sid: number) => {
    const onMap = state.systems?.get(sid);
    return onMap ? systemDisplayName(onMap, universe.get(sid)) : (universe.get(sid)?.name ?? String(sid));
  };

  const handle = phone ? (
    <button
      type="button"
      className={styles.handle}
      aria-label={
        stop === 'full'
          ? 'Collapse the panel'
          : stop === 'half'
            ? 'Expand the panel fully'
            : 'Expand the panel'
      }
      onPointerDown={startSheetDrag}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setStop((s) => NEXT_STOP[s]);
        }
      }}
    >
      <span aria-hidden />
    </button>
  ) : undefined;

  return (
    <aside
      ref={rootRef}
      className={styles.sidebar}
      aria-label="System"
      hidden={!open}
      data-phone={phone || undefined}
      data-stop={phone ? stop : undefined}
      data-dragging={drag !== null || undefined}
      style={phone ? { height: sheet } : { width }}
    >
      {!phone && (
        <div
          className={styles.resize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panel"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_WIDTH.min}
          aria-valuemax={SIDEBAR_WIDTH.max}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeKey}
          onDoubleClick={() => setWidth(SIDEBAR_WIDTH.default)}
        />
      )}
      <SystemIdentity
        system={system}
        info={info}
        can={can}
        store={store}
        onClose={onClose}
        dragHandle={handle}
      />
      {note}
      <div className={styles.scroll}>
        <SidebarSection
          id="system"
          title="System"
          collapsed={!!collapsed.system}
          onToggle={toggle}
          action={<SetDestination solarSystemId={id} name={name} />}
        >
          <SystemDetails
            // A field being edited belongs to its system: another system starts clean.
            key={id}
            system={system}
            info={info}
            labels={labels}
            can={can}
            store={store}
            focusToken={focusToken}
            focusedRef={focusedRef}
          />
        </SidebarSection>
        <SidebarSection
          id="signatures"
          title="Signatures"
          count={signatures.length}
          collapsed={!!collapsed.signatures}
          onToggle={toggle}
          action={
            <span className={styles.sectionActions}>
              {can.edit && canReadClipboard() && (
                <IconButton
                  size="sm"
                  label="Paste from clipboard"
                  tooltipSide="left"
                  icon={<ClipboardPaste />}
                  loading={paste.busy}
                  onClick={() => void pasteFromClipboard(paste)}
                />
              )}
              <SignatureSettingsMenu can={can} />
            </span>
          }
        >
          <SignaturesSection
            key={id}
            mapId={mapId}
            solarSystemId={id}
            signatures={signatures}
            streamed={state.has.signatures}
            connections={state.connections}
            universe={universe}
            can={can}
            store={store}
            paste={paste}
            onSelectSystem={onSelectSystem}
            systemName={systemName}
          />
        </SidebarSection>
        <StructuresSection
          key={`structures:${id}`}
          mapId={mapId}
          solarSystemId={id}
          can={can}
          collapsed={!!collapsed.structures}
          onToggle={toggle}
        />
        <CommentsSection
          key={`comments:${id}`}
          mapId={mapId}
          solarSystemId={id}
          can={can}
          collapsed={!!collapsed.comments}
          onToggle={toggle}
        />
        <SidebarSection
          id="local"
          title="Local"
          count={here.length}
          collapsed={!!collapsed.local}
          onToggle={toggle}
          action={
            can.edit && (
              <TrackMenu
                mapId={mapId}
                myCharacters={myCharacters}
                tracked={tracked}
                onChanged={() => presence.refetch()}
              />
            )
          }
        >
          <LocalSection here={here} mine={mine} />
        </SidebarSection>
        <HistorySection
          key={`history:${id}`}
          mapId={mapId}
          solarSystemId={id}
          universe={universe}
          can={can}
          collapsed={!!collapsed.history}
          onToggle={toggle}
        />
        {plugins.map((entry) => (
          <SidebarSection
            key={entry.key}
            id={entry.key}
            title={entry.title}
            collapsed={!!collapsed[entry.key]}
            onToggle={toggle}
          >
            <div className={styles.plugin}>
              <SlotItem entry={entry} props={{ mapId }} />
            </div>
          </SidebarSection>
        ))}
      </div>
    </aside>
  );
}
