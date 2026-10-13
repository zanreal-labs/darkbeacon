'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardPaste, SlidersHorizontal } from 'lucide-react';
import type {
  CharacterDto,
  ConnectionDto,
  LabelDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import { useSystemActivity } from '../../lib/intel';
import type { MapPermissions } from '../../lib/roles';
import { SlotItem } from '../../plugins/PluginSlot';
import type { SlotEntry } from '../../plugins/registry';
import { IconButton } from '../../ui';
import type { MapState } from '../mapState';
import type { MapStore } from '../useMapStore';
import { ActivitySection, SystemHolder } from './ActivitySection';
import { RoutesSidebarSection } from '../routes/RoutesSection';
import { ConnectionsSection } from './ConnectionsSection';
import { KillsSection, KillsSettingsMenu, useKillList, useKillsSettings } from './KillsSection';
import { DEFAULT_OPEN_SECTIONS, SidebarLayoutProvider } from './layout';
import { LocalMenu, LocalSection, usePresence } from './LocalSection';
import { SectionsDialog } from './SectionsDialog';
import { SidebarSection } from './SidebarSection';
import { SidebarShell } from './SidebarShell';
import {
  canReadClipboard,
  looksLikeScanner,
  pasteFromClipboard,
  SignaturesSection,
  useSignaturePaste,
} from './SignaturesSection';
import { useOpenSections } from './storage';
import { CommentsSection } from './CommentsSection';
import { HistorySection } from './HistorySection';
import { StructuresSection } from './StructuresSection';
import { SignatureSettingsMenu } from '../signatures/SignatureSettingsMenu';
import { systemDisplayName } from '../SystemNode';
import { marksSummary, SetDestination, SystemDetails, SystemIdentity, SystemLinks } from './SystemDetails';
import styles from './sidebar.module.css';

export { SIDEBAR_WIDTH, sheetHeight, useSidebarWidth, type SheetStop } from './SidebarShell';

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** "3 unscanned · 2 WH": what the Signatures title bar says about the probed ones (anomalies have their own fold). */
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

interface Props {
  mapId: string;
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  universe: Map<number, UniverseSystemDto>;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...). */
  systemLabels?: readonly SystemLabelDto[];
  state: Pick<MapState, 'signatures' | 'connections' | 'characters' | 'has'> &
    Partial<Pick<MapState, 'systems'>>;
  can: MapPermissions;
  store: Pick<
    MapStore,
    'updateSystem' | 'pasteSignatures' | 'updateSignature' | 'removeSignature' | 'seed' | 'updateConnection'
  >;
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
 * Everything about the selected system, read in a second: a fixed header (pill, name, status,
 * where, effect, statics, notes), then compact sections that each fold on their own and sum
 * themselves up in their title bar ("Signatures 12 · 3 unscanned", "Local 4"). Signatures and
 * Local start open, the rest folded; what someone opens or folds is remembered. Docked to the
 * right on wide screens (resizable), a bottom sheet with peek, half and full stops on phones.
 * Ctrl+V anywhere outside a text field pastes probe scanner results into the selected system.
 */
export function SystemSidebar({
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
  open,
  focusToken,
  onClose,
  onSelectSystem,
  onCover,
  note,
}: Props) {
  const { isOpen, toggle, expand } = useOpenSections(DEFAULT_OPEN_SECTIONS);
  const folded = (section: string) => !isOpen(section);
  const [customizing, setCustomizing] = useState(false);
  const id = system.solarSystemId;

  const paste = useSignaturePaste(mapId, id, store);
  const [killSettings, setKillSettings] = useKillsSettings(mapId);
  const kills = useKillList(mapId, id, killSettings);
  const activity = useSystemActivity(mapId, id);
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
  const intel = activity.data?.intel;
  const activityText = intel
    ? [
        `${intel.kills1h} ${intel.kills1h === 1 ? 'kill' : 'kills'}`,
        intel.jumps1h !== null && `${intel.jumps1h} jumps`,
      ]
        .filter(Boolean)
        .join(' · ') + ' /1h'
    : undefined;
  const killsScope = `${killSettings.hours}h${killSettings.scope === 'all' ? ', map' : ''}`;

  return (
    <SidebarShell
      label="System"
      open={open}
      resetKey={id}
      onCover={onCover}
      note={note}
      header={(handle) => (
        <SystemIdentity
          system={system}
          info={info}
          can={can}
          store={store}
          onClose={onClose}
          dragHandle={handle}
          holder={<SystemHolder mapId={mapId} solarSystemId={id} />}
          notes={folded('system') ? system.description : undefined}
          onOpenNotes={() => expand('system')}
        />
      )}
    >
      <SidebarLayoutProvider extra={plugins.map((p) => p.key)}>
        <SidebarSection
          id="system"
          title="System"
          summary={marksSummary(system, labels, systemLabels)}
          collapsed={folded('system')}
          onToggle={toggle}
          action={
            <span className={styles.sectionActions}>
              <SetDestination solarSystemId={id} name={name} />
              {info && <SystemLinks info={info} />}
            </span>
          }
        >
          <SystemDetails
            // A field being edited belongs to its system: another system starts clean.
            key={id}
            system={system}
            labels={labels}
            systemLabels={systemLabels}
            can={can}
            store={store}
            focusToken={focusToken}
            focusedRef={focusedRef}
          />
        </SidebarSection>
        <SidebarSection
          id="signatures"
          title="Signatures"
          count={sigs.count}
          summary={sigs.text}
          alert={sigs.unscanned > 0}
          collapsed={folded('signatures')}
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
        <SidebarSection
          id="local"
          title="Local"
          count={here.length}
          summary={offline > 0 ? `${offline} offline` : undefined}
          collapsed={folded('local')}
          onToggle={toggle}
          action={
            <LocalMenu
              mapId={mapId}
              myCharacters={myCharacters}
              tracked={tracked}
              canTrack={can.edit}
              onChanged={() => presence.refetch()}
            />
          }
        >
          <LocalSection
            here={here}
            mine={mine}
            expired={new Set(myCharacters.filter((c) => !c.tokenValid).map((c) => c.id))}
          />
        </SidebarSection>
        <StructuresSection
          key={`structures:${id}`}
          mapId={mapId}
          solarSystemId={id}
          can={can}
          collapsed={folded('structures')}
          onToggle={toggle}
        />
        <CommentsSection
          key={`comments:${id}`}
          mapId={mapId}
          solarSystemId={id}
          can={can}
          collapsed={folded('comments')}
          onToggle={toggle}
        />
        <SidebarSection
          id="connections"
          title="Connections"
          count={links.length}
          summary={linksText}
          alert={linksText !== ''}
          collapsed={folded('connections')}
          onToggle={toggle}
        >
          <ConnectionsSection
            solarSystemId={id}
            connections={state.connections}
            universe={universe}
            can={can}
            store={store}
            onSelectSystem={onSelectSystem}
          />
        </SidebarSection>
        <SidebarSection
          id="kills"
          title="Kills"
          count={kills.kills.data ? kills.list.length : undefined}
          summary={killsScope}
          alert={kills.list.length > 0}
          collapsed={folded('kills')}
          onToggle={toggle}
          action={
            <KillsSettingsMenu
              settings={killSettings}
              update={setKillSettings}
              solarSystemId={id}
              systemName={name}
            />
          }
        >
          <KillsSection mapId={mapId} solarSystemId={id} settings={killSettings} universe={universe} />
        </SidebarSection>
        <SidebarSection
          id="activity"
          title="Activity"
          summary={activityText}
          alert={(intel?.kills1h ?? 0) >= 5}
          collapsed={folded('activity')}
          onToggle={toggle}
        >
          <ActivitySection key={id} mapId={mapId} solarSystemId={id} />
        </SidebarSection>
        <RoutesSidebarSection
          mapId={mapId}
          solarSystemId={id}
          can={can}
          myCharacters={myCharacters}
          onMap={new Set(universe.keys())}
          onSelectSystem={onSelectSystem}
          collapsed={folded('routes')}
          onToggle={toggle}
        />
        <HistorySection
          key={`history:${id}`}
          mapId={mapId}
          solarSystemId={id}
          universe={universe}
          can={can}
          collapsed={folded('history')}
          onToggle={toggle}
        />
        {plugins.map((entry) => (
          <SidebarSection
            key={entry.key}
            id={entry.key}
            title={entry.title}
            collapsed={folded(entry.key)}
            onToggle={toggle}
          >
            <div className={styles.plugin}>
              <SlotItem entry={entry} props={{ mapId }} />
            </div>
          </SidebarSection>
        ))}
      </SidebarLayoutProvider>
      <div className={styles.customize}>
        <button type="button" onClick={() => setCustomizing(true)}>
          <SlidersHorizontal aria-hidden />
          Sidebar sections
        </button>
      </div>
      <SectionsDialog
        open={customizing}
        onOpenChange={setCustomizing}
        extra={plugins.map((p) => ({ id: p.key, title: p.title }))}
      />
    </SidebarShell>
  );
}
