'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ClipboardPaste } from 'lucide-react';
import type {
  CharacterDto,
  LabelDto,
  MapSystemDto,
  SystemLabelDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
import { SlotItem } from '../../plugins/PluginSlot';
import type { SlotEntry } from '../../plugins/registry';
import { IconButton } from '../../ui';
import type { MapState } from '../mapState';
import type { MapStore } from '../useMapStore';
import { ActivitySection, SystemHolder } from './ActivitySection';
import { RoutesSidebarSection } from '../routes/RoutesSection';
import { ConnectionsSection } from './ConnectionsSection';
import { KillsSection, KillsSettingsMenu, useKillsSettings } from './KillsSection';
import { LocalSection, TrackMenu, usePresence } from './LocalSection';
import { SidebarSection } from './SidebarSection';
import { SidebarShell } from './SidebarShell';
import {
  canReadClipboard,
  looksLikeScanner,
  pasteFromClipboard,
  SignaturesSection,
  useSignaturePaste,
} from './SignaturesSection';
import { useCollapsedSections } from './storage';
import { SetDestination, SystemDetails, SystemIdentity } from './SystemDetails';
import styles from './sidebar.module.css';

export { SIDEBAR_WIDTH, sheetHeight, useSidebarWidth, type SheetStop } from './SidebarShell';

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface Props {
  mapId: string;
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  universe: Map<number, UniverseSystemDto>;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...). */
  systemLabels?: readonly SystemLabelDto[];
  state: Pick<MapState, 'signatures' | 'connections' | 'characters' | 'has'>;
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
  const { collapsed, toggle, expand } = useCollapsedSections();
  const id = system.solarSystemId;

  const paste = useSignaturePaste(id, store);
  const [killSettings, setKillSettings] = useKillsSettings(mapId);
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
  const here = [...state.characters.values()].filter((c) => c.solarSystemId === id);
  const connectionCount = [...state.connections.values()].filter(
    (c) => c.source === id || c.target === id,
  ).length;
  const mine = new Set(myCharacters.map((c) => c.id));
  const tracked = new Set([...state.characters.values()].map((c) => c.characterId));
  const name = info?.name ?? 'this system';

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
        />
      )}
    >
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
        count={signatures.length}
        collapsed={!!collapsed.signatures}
        onToggle={toggle}
        action={
          can.edit &&
          canReadClipboard() && (
            <IconButton
              size="sm"
              label="Paste from clipboard"
              tooltipSide="left"
              icon={<ClipboardPaste />}
              loading={paste.busy}
              onClick={() => void pasteFromClipboard(paste)}
            />
          )
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
        />
      </SidebarSection>
      <SidebarSection
        id="connections"
        title="Connections"
        count={connectionCount}
        collapsed={!!collapsed.connections}
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
      <SidebarSection id="activity" title="Activity" collapsed={!!collapsed.activity} onToggle={toggle}>
        <ActivitySection key={id} mapId={mapId} solarSystemId={id} />
      </SidebarSection>
      <SidebarSection
        id="kills"
        title="Kills"
        collapsed={!!collapsed.kills}
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
      <RoutesSidebarSection
        mapId={mapId}
        solarSystemId={id}
        can={can}
        myCharacters={myCharacters}
        onMap={new Set(universe.keys())}
        onSelectSystem={onSelectSystem}
        collapsed={!!collapsed.routes}
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
    </SidebarShell>
  );
}
