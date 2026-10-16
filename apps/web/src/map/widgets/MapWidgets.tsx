'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Building2,
  ClipboardPaste,
  Crosshair,
  History,
  Info,
  MessagesSquare,
  Puzzle,
  Radar,
  Route,
  Users,
  Waypoints,
} from 'lucide-react';
import type {
  CharacterDto,
  CharacterPresenceDto,
  ConnectionDto,
  LabelDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import { useStandings } from '../../lib/intel';
import type { MapPermissions } from '../../lib/roles';
import { SlotItem } from '../../plugins/PluginSlot';
import type { SlotEntry } from '../../plugins/registry';
import { IconButton } from '../../ui';
import type { MapState } from '../mapState';
import { RoutesWidget } from '../routes/RoutesSection';
import { SignatureSettingsMenu } from '../signatures/SignatureSettingsMenu';
import { systemDisplayName } from '../SystemNode';
import type { MapStore } from '../useMapStore';
import { CommentsSection } from './CommentsSection';
import { ConnectionsSection } from './ConnectionsSection';
import { HistorySection } from './HistorySection';
import { KillsSection, KillsSettingsMenu, useKillList, useKillsSettings } from './KillsSection';
import { CORE_WIDGETS, pluginWidgetId, resolveBoxes, type Area } from './layout';
import { LocalMenu, LocalSection, pilotStanding, usePresence } from './LocalSection';
import {
  canReadClipboard,
  looksLikeScanner,
  pasteFromClipboard,
  RemoveMissing,
  SignaturesSection,
  useSignaturePaste,
} from './SignaturesSection';
import { usePhone } from './storage';
import { StructuresSection } from './StructuresSection';
import { SystemInfoWidget } from './SystemDetails';
import type { WidgetsController } from './useWidgetsLayout';
import { WidgetHostContext, WidgetWindow, type WidgetBadge, type WidgetHost } from './WidgetWindow';
import styles from './widgets.module.css';
import win from './window.module.css';

const ICONS: Record<string, ComponentType> = {
  info: Info,
  signatures: Radar,
  local: Users,
  routes: Route,
  kills: Crosshair,
  structures: Building2,
  comments: MessagesSquare,
  connections: Waypoints,
  history: History,
};

/** The dock's short word for a widget. */
const SHORT: Record<string, string> = { info: 'System', signatures: 'Sigs' };

/** A window whose content got shorter waits this long before it shrinks (it may only be loading). */
const SHRINK_DELAY = 400;

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** "3 unscanned · 2 WH": what the Signatures title bar says about the probed ones. */
export function signaturesSummary(signatures: readonly SignatureDto[]): {
  count: number;
  text: string;
  unscanned: number;
} {
  const probed = signatures.filter((s) => (s.kind ?? 'signature') === 'signature');
  const unscanned = probed.filter((s) => s.group === 'unknown').length;
  const holes = probed.filter((s) => s.group === 'wormhole').length;
  return {
    count: probed.length,
    unscanned,
    text: [unscanned > 0 && `${unscanned} unscanned`, holes > 0 && `${holes} WH`].filter(Boolean).join(' · '),
  };
}

/** "1 hostile · 2 offline": what the Local title bar says about the pilots here. */
export function localSummary(
  here: readonly CharacterPresenceDto[],
  standings: ReadonlyMap<number, number>,
): { text: string; hostile: number } {
  const hostile = here.filter((c) => (pilotStanding(c, standings) ?? 0) < 0).length;
  const offline = here.filter((c) => !c.online).length;
  return {
    hostile,
    text: [hostile > 0 && `${hostile} hostile`, offline > 0 && `${offline} offline`]
      .filter(Boolean)
      .join(' · '),
  };
}

/** "1 EOL · 1 crit": connections of the system that are going away. */
export function connectionsSummary(connections: readonly ConnectionDto[]): string {
  const eol = connections.filter((c) => c.timeStatus === 'eol').length;
  const critical = connections.filter((c) => c.massStatus === 'critical').length;
  const reduced = connections.filter((c) => c.massStatus === 'reduced').length;
  return [eol > 0 && `${eol} EOL`, critical > 0 && `${critical} crit`, reduced > 0 && `${reduced} reduced`]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What the widgets cover for good: the docked column on the right (its width, and how far down
 * from the top of the map view it reaches) or the dock at the bottom on phones.
 */
export interface WidgetCover {
  right: number;
  /** Where the column ends, from the top of the map view; 0 without one. */
  rightBottom: number;
  bottom: number;
}

type Store = Pick<
  MapStore,
  'updateSystem' | 'pasteSignatures' | 'updateSignature' | 'removeSignature' | 'seed' | 'updateConnection'
>;

interface Props {
  mapId: string;
  /** The selected system; nothing selected, no widget shows. */
  system: MapSystemDto | undefined;
  info: UniverseSystemDto | undefined;
  universe: Map<number, UniverseSystemDto>;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...). */
  systemLabels?: readonly SystemLabelDto[];
  state: Pick<MapState, 'signatures' | 'connections' | 'characters' | 'has'> &
    Partial<Pick<MapState, 'systems'>>;
  can: MapPermissions;
  /** On a merged map: what the viewer may do with one connection (it may come from elsewhere). */
  connectionCan?(connection: ConnectionDto): MapPermissions;
  /** On a merged map: whether the viewer manages the map behind a source (lifts its locks). */
  managesSource?(sourceId: string): boolean;
  store: Store;
  myCharacters: CharacterDto[];
  plugins: readonly SlotEntry<'widget'>[];
  controller: WidgetsController;
  /** All windows shown, or all hidden for a moment (the widgets menu). */
  shown: boolean;
  onSelectSystem(solarSystemId: number): void;
  /** Opens Edit system for the selected system (System info's pencil). */
  onEdit?(solarSystemId: number): void;
  onCover(cover: WidgetCover): void;
  /** One quiet line in System info (where a merged system comes from). */
  note?: ReactNode;
}

/**
 * The map widgets (Wanderer's): separate windows over the map, each with one job, all showing the
 * selected system, and nothing at all while none is. On wide screens they stand in a narrow
 * column against the right edge, each as tall as its content, or float where someone dragged
 * them; on phones a dock lists them and one opens at a time in a sheet above it, as in Wanderer's
 * mobile layout.
 */
export function MapWidgets(props: Props) {
  const { controller, plugins, shown, onCover, system } = props;
  // Pilots on the map (Local, the nodes' counts) whether or not a system is selected.
  const presence = usePresence(props.mapId, props.store);
  const phone = usePhone();
  const layerRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [layerTop, setLayerTop] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [badges, setBadges] = useState<Record<string, WidgetBadge>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});
  const heightsRef = useRef(heights);
  const shrinking = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const selected = system?.solarSystemId ?? null;

  const titles = useMemo(
    () =>
      new Map<string, string>([
        ...CORE_WIDGETS.map((w) => [w.id, w.title] as [string, string]),
        ...plugins.map((p) => [pluginWidgetId(p), p.title] as [string, string]),
      ]),
    [plugins],
  );
  const visible = controller.visible.filter((id) => titles.has(id));

  // The map's size: windows are placed and kept inside it.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const measure = () => {
      const next = { width: layer.clientWidth, height: layer.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setLayerTop(layer.offsetTop);
      setArea((a) => (a && a.width === next.width && a.height === next.height ? a : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(layer);
    return () => observer?.disconnect();
  }, [phone, shown]);

  // How tall each window's content is: taller at once, shorter only after a moment, so a list that
  // empties while the next system loads does not make the column jump twice.
  const reportHeight = useCallback((id: string, height: number) => {
    const pending = shrinking.current.get(id);
    if (pending) clearTimeout(pending);
    shrinking.current.delete(id);
    const apply = () => {
      if (heightsRef.current[id] === height) return;
      heightsRef.current = { ...heightsRef.current, [id]: height };
      setHeights(heightsRef.current);
    };
    const was = heightsRef.current[id];
    if (was === undefined || height >= was) apply();
    else shrinking.current.set(id, setTimeout(apply, SHRINK_DELAY));
  }, []);
  useEffect(() => {
    const timers = shrinking.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const resolved = area ? resolveBoxes(controller.layout, area, visible, heights) : null;

  // What the canvas keeps clear: the column of windows on the right, the dock on phones.
  const active = shown && selected !== null;
  const column = !phone && active ? resolved?.column : null;
  const right = column?.width ?? 0;
  const rightBottom = column ? column.bottom + layerTop : 0;
  const bottom = phone && active && visible.length > 0 ? 54 : 0;
  useEffect(() => {
    onCover({ right, rightBottom, bottom });
  }, [right, rightBottom, bottom, onCover]);

  // A widget hidden while open in the sheet closes it.
  if (open && !visible.includes(open)) setOpen(null);

  const reportBadge = useCallback((id: string, badge: WidgetBadge) => {
    setBadges((current) => {
      const was = current[id];
      return was && was.count === badge.count && was.alert === badge.alert
        ? current
        : { ...current, [id]: badge };
    });
  }, []);

  const host: WidgetHost = {
    mode: phone ? 'phone' : 'float',
    area: area ?? { width: 0, height: 0 },
    boxes: resolved?.boxes ?? {},
    docked: resolved?.docked ?? new Set(),
    order: controller.layout.order,
    controller,
    open,
    setOpen,
    report: reportBadge,
    reportHeight,
    resetKey: selected,
  };

  if (!shown) return null;

  const content = system ? (
    <SystemWidgets
      {...props}
      system={system}
      visible={visible}
      phone={phone}
      refetchPresence={() => presence.refetch()}
    />
  ) : null;

  return (
    <WidgetHostContext.Provider value={host}>
      {phone ? (
        system && (
          <>
            {open && (
              <button
                type="button"
                className={win.backdrop}
                aria-label="Close the widget"
                tabIndex={-1}
                onClick={() => setOpen(null)}
              />
            )}
            {content}
            {visible.length > 0 && (
              <ul className={win.dock} aria-label="Widgets">
                {visible.map((id) => {
                  const Icon = ICONS[id] ?? Puzzle;
                  const badge = badges[id];
                  const title = titles.get(id) ?? id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={win.dockButton}
                        aria-pressed={open === id}
                        aria-label={badge?.count !== undefined ? `${title} ${badge.count}` : title}
                        onClick={() => setOpen((o) => (o === id ? null : id))}
                      >
                        <Icon aria-hidden />
                        <span aria-hidden>{SHORT[id] ?? title}</span>
                        {badge?.count ? (
                          <span className={win.dockCount} data-alert={badge.alert || undefined} aria-hidden>
                            {badge.count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )
      ) : (
        // The layer stays while nothing is selected: it knows the map's size before a window shows.
        <div ref={layerRef} className={win.layer} data-widgets-layer>
          {area && content}
        </div>
      )}
    </WidgetHostContext.Provider>
  );
}

/** Every shown widget, for the selected system. */
function SystemWidgets({
  mapId,
  system,
  info,
  universe,
  labels,
  systemLabels = [],
  state,
  can,
  connectionCan,
  managesSource,
  store,
  myCharacters,
  plugins,
  onSelectSystem,
  onEdit,
  note,
  visible,
  phone,
  refetchPresence,
}: Props & {
  system: MapSystemDto;
  visible: readonly string[];
  phone: boolean;
  refetchPresence(): Promise<unknown>;
}) {
  const id = system.solarSystemId;
  const show = (widget: string) => visible.includes(widget);
  const paste = useSignaturePaste(mapId, id, store);
  const standings = useStandings();

  // Ctrl+V on the map or in a widget pastes the scan, never into a field someone is typing in.
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

  const signatures = [...state.signatures.values()].filter((s) => s.solarSystemId === id);
  const sigs = signaturesSummary(signatures);
  const here = [...state.characters.values()].filter((c) => c.solarSystemId === id);
  const local = localSummary(here, standings);
  const links = [...state.connections.values()].filter((c) => c.source === id || c.target === id);
  const linksText = connectionsSummary(links);
  const mine = new Set(myCharacters.map((c) => c.id));
  const tracked = new Set([...state.characters.values()].map((c) => c.characterId));
  const name = info?.name ?? 'this system';
  const systemName = (sid: number) => {
    const onMap = state.systems?.get(sid);
    return onMap ? systemDisplayName(onMap, universe.get(sid)) : (universe.get(sid)?.name ?? String(sid));
  };

  return (
    <>
      {show('info') && (
        <SystemInfoWidget
          mapId={mapId}
          system={system}
          info={info}
          labels={labels}
          systemLabels={systemLabels}
          canEdit={can.edit}
          onEdit={onEdit && (() => onEdit(id))}
          note={note}
        />
      )}
      {show('signatures') && (
        <WidgetWindow
          id="signatures"
          title="Signatures"
          count={sigs.count}
          summary={sigs.text}
          alert={sigs.unscanned > 0}
          actions={
            <>
              {can.edit && <RemoveMissing paste={paste} />}
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
            </>
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
            pasteField={phone ? 'always' : 'empty'}
          />
        </WidgetWindow>
      )}
      {show('local') && (
        <WidgetWindow
          id="local"
          title="Local"
          count={here.length}
          summary={local.text || undefined}
          alert={local.hostile > 0}
          actions={
            <LocalMenu
              mapId={mapId}
              myCharacters={myCharacters}
              tracked={tracked}
              canTrack={can.edit}
              onChanged={refetchPresence}
            />
          }
        >
          <LocalSection
            here={here}
            mine={mine}
            standings={standings}
            expired={new Set(myCharacters.filter((c) => !c.tokenValid).map((c) => c.id))}
          />
        </WidgetWindow>
      )}
      {show('routes') && (
        <RoutesWidget
          mapId={mapId}
          solarSystemId={id}
          can={can}
          myCharacters={myCharacters}
          onMap={new Set(universe.keys())}
          onSelectSystem={onSelectSystem}
        />
      )}
      {show('kills') && <KillsWidget mapId={mapId} solarSystemId={id} name={name} universe={universe} />}
      {show('structures') && (
        <StructuresSection key={`structures:${id}`} mapId={mapId} solarSystemId={id} can={can} />
      )}
      {show('comments') && (
        <CommentsSection key={`comments:${id}`} mapId={mapId} solarSystemId={id} can={can} />
      )}
      {show('connections') && (
        <WidgetWindow
          id="connections"
          title="Connections"
          count={links.length}
          summary={linksText}
          alert={linksText !== ''}
        >
          <ConnectionsSection
            solarSystemId={id}
            connections={state.connections}
            universe={universe}
            can={can}
            connectionCan={connectionCan}
            managesSource={managesSource}
            store={store}
            onSelectSystem={onSelectSystem}
          />
        </WidgetWindow>
      )}
      {show('history') && (
        <HistorySection
          key={`history:${id}`}
          mapId={mapId}
          solarSystemId={id}
          universe={universe}
          can={can}
        />
      )}
      {plugins
        .filter((entry) => show(pluginWidgetId(entry)))
        .map((entry) => (
          <WidgetWindow key={entry.key} id={pluginWidgetId(entry)} title={entry.title}>
            <div className={styles.plugin}>
              <SlotItem entry={entry} props={{ mapId }} />
            </div>
          </WidgetWindow>
        ))}
    </>
  );
}

/**
 * Kills: the killmails, with the viewer's choices (this system or the whole map, holes only,
 * 4/12/24 h). The system's numbers (kills per hour and day, who kills here) are in System info.
 */
function KillsWidget({
  mapId,
  solarSystemId,
  name,
  universe,
}: {
  mapId: string;
  solarSystemId: number;
  name: string;
  universe: Map<number, UniverseSystemDto>;
}) {
  const [settings, update] = useKillsSettings(mapId);
  const kills = useKillList(mapId, solarSystemId, settings);
  return (
    <WidgetWindow
      id="kills"
      title="Kills"
      count={kills.kills.data ? kills.list.length : undefined}
      summary={`${settings.hours}h${settings.scope === 'all' ? ', map' : ''}`}
      alert={kills.list.length > 0}
      actions={
        <KillsSettingsMenu
          settings={settings}
          update={update}
          solarSystemId={solarSystemId}
          systemName={name}
        />
      }
    >
      <KillsSection mapId={mapId} solarSystemId={solarSystemId} settings={settings} universe={universe} />
    </WidgetWindow>
  );
}
