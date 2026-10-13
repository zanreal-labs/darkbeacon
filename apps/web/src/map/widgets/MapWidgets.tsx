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
  ConnectionDto,
  LabelDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
import { SlotItem } from '../../plugins/PluginSlot';
import type { SlotEntry } from '../../plugins/registry';
import { IconButton } from '../../ui';
import type { MapState } from '../mapState';
import { RoutesWidget } from '../routes/RoutesSection';
import { SignatureSettingsMenu } from '../signatures/SignatureSettingsMenu';
import { systemDisplayName } from '../SystemNode';
import type { MapStore } from '../useMapStore';
import { ActivityStrip, SystemHolder, WhoFliesHere } from './ActivitySection';
import { CommentsSection } from './CommentsSection';
import { ConnectionsSection } from './ConnectionsSection';
import { HistorySection } from './HistorySection';
import { KillsSection, KillsSettingsMenu, useKillList, useKillsSettings } from './KillsSection';
import { CORE_WIDGETS, coveredRight, pluginWidgetId, resolveBoxes, type Area } from './layout';
import { LocalMenu, LocalSection, usePresence } from './LocalSection';
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
import { NoSystem, WidgetHostContext, WidgetWindow, type WidgetBadge, type WidgetHost } from './WidgetWindow';
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

/** "1 EOL · 1 crit": connections of the system that are going away. */
export function connectionsSummary(connections: readonly ConnectionDto[]): string {
  const eol = connections.filter((c) => c.timeStatus === 'eol').length;
  const critical = connections.filter((c) => c.massStatus === 'critical').length;
  const reduced = connections.filter((c) => c.massStatus === 'reduced').length;
  return [eol > 0 && `${eol} EOL`, critical > 0 && `${critical} crit`, reduced > 0 && `${reduced} reduced`]
    .filter(Boolean)
    .join(' · ');
}

type Store = Pick<
  MapStore,
  'updateSystem' | 'pasteSignatures' | 'updateSignature' | 'removeSignature' | 'seed' | 'updateConnection'
>;

interface Props {
  mapId: string;
  /** The selected system; nothing selected, every widget says so. */
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
  store: Store;
  myCharacters: CharacterDto[];
  plugins: readonly SlotEntry<'widget'>[];
  controller: WidgetsController;
  /** All windows shown, or all hidden for a moment (the widgets menu). */
  shown: boolean;
  /** Bumped to show System info and focus the name field (the context menu's Edit). */
  focusToken: number;
  onSelectSystem(solarSystemId: number): void;
  /** Pixels of the map the widgets cover for good: the phone dock. */
  onCover(cover: { right: number; bottom: number }): void;
  /** One quiet line in System info (where a merged system comes from). */
  note?: ReactNode;
}

/**
 * The map widgets (Wanderer's): separate windows over the map, each with one job, all showing the
 * selected system. On wide screens they float where they were left; on phones they cannot, so a
 * dock lists them and one opens at a time in a sheet above it, as in Wanderer's mobile layout.
 */
export function MapWidgets(props: Props) {
  const { controller, plugins, shown, focusToken, onCover } = props;
  const phone = usePhone();
  const layerRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [badges, setBadges] = useState<Record<string, WidgetBadge>>({});

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
  const { setArea: report } = controller;
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const measure = () => {
      const next = { width: layer.clientWidth, height: layer.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      report(next);
      setArea((a) => (a && a.width === next.width && a.height === next.height ? a : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(layer);
    return () => observer?.disconnect();
  }, [phone, shown, report]);

  const boxes = area ? resolveBoxes(controller.layout, area, visible) : {};

  // What the canvas keeps clear: the column of windows on the right, the dock on phones.
  const right = !phone && shown && area ? coveredRight(Object.values(boxes), area) : 0;
  useEffect(() => {
    onCover({ right, bottom: phone && shown && visible.length > 0 ? 54 : 0 });
  }, [phone, shown, visible.length, right, onCover]);

  // The context menu's Edit: System info shows, in front (on phones, in the sheet).
  const [seenFocus, setSeenFocus] = useState(focusToken);
  if (seenFocus !== focusToken) {
    setSeenFocus(focusToken);
    if (phone) setOpen('info');
  }
  const handledFocus = useRef(focusToken);
  const { setShown, raise } = controller;
  useEffect(() => {
    if (focusToken === handledFocus.current) return;
    handledFocus.current = focusToken;
    setShown('info', true);
    raise('info');
  }, [focusToken, setShown, raise]);

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
    boxes,
    order: controller.layout.order,
    controller,
    open,
    setOpen,
    report: reportBadge,
  };

  if (!shown) return null;

  const content = <Widgets {...props} visible={visible} titles={titles} phone={phone} />;

  return (
    <WidgetHostContext.Provider value={host}>
      {phone ? (
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
      ) : (
        <div ref={layerRef} className={win.layer} data-widgets-layer>
          {area && content}
        </div>
      )}
    </WidgetHostContext.Provider>
  );
}

function Widgets({
  visible,
  titles,
  phone,
  ...props
}: Props & { visible: readonly string[]; titles: ReadonlyMap<string, string>; phone: boolean }) {
  const presence = usePresence(props.mapId, props.store);
  if (!props.system)
    return visible.map((id) => (
      <WidgetWindow key={id} id={id} title={titles.get(id) ?? id}>
        <NoSystem />
      </WidgetWindow>
    ));
  return (
    <SystemWidgets
      {...props}
      system={props.system}
      visible={visible}
      phone={phone}
      refetchPresence={() => presence.refetch()}
    />
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
  store,
  myCharacters,
  plugins,
  focusToken,
  onSelectSystem,
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
  const focusedRef = useRef(0);

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
  const offline = here.filter((c) => !c.online).length;
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
          system={system}
          info={info}
          labels={labels}
          systemLabels={systemLabels}
          can={can}
          store={store}
          holder={<SystemHolder mapId={mapId} solarSystemId={id} />}
          note={note}
          focusToken={focusToken}
          focusedRef={focusedRef}
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
          summary={offline > 0 ? `${offline} offline` : undefined}
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
 * Kills: the last hour in one row (kills, NPC kills, jumps, the day as bars), the killmails with
 * the viewer's choices (this system or the whole map, holes only, 4/12/24 h), then who flies here.
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
      <ActivityStrip mapId={mapId} solarSystemId={solarSystemId} />
      <KillsSection mapId={mapId} solarSystemId={solarSystemId} settings={settings} universe={universe} />
      <WhoFliesHere mapId={mapId} solarSystemId={solarSystemId} />
    </WidgetWindow>
  );
}
