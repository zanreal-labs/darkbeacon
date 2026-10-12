'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, PanelRight, RotateCcw, Upload } from 'lucide-react';
import { ApiError } from '../lib/api';
import {
  BROWSER_AREA,
  exportPreferences,
  parsePreferencesFile,
  readBrowserOptions,
  usePreferences,
  useSavePreferences,
  writeBrowserOptions,
} from '../lib/preferences';
import { useLocalOptions } from '../map/sidebar/LocalSection';
import { SectionsDialog } from '../map/sidebar/SectionsDialog';
import { SIDEBAR_SECTIONS, useSidebarLayout } from '../map/sidebar/layout';
import { Button, Card, CardBody, CardFooter, CardHeader, ConfirmDialog, Switch, useToast } from '../ui';
import styles from './AccountPage.module.css';

const sectionTitle = (id: string) => SIDEBAR_SECTIONS.find((s) => s.id === id)?.title ?? id;

/**
 * "My preferences": the options that follow me between browsers in one place, with export,
 * import and reset. Local and the sidebar are set here; the options other parts of the map keep
 * (signature columns, the legend, kills and routes) travel along from wherever they were set.
 */
export function MyPreferences() {
  const toast = useToast();
  const preferences = usePreferences();
  const save = useSavePreferences();
  const [local, setLocal] = useLocalOptions();
  const [layout] = useSidebarLayout();
  const [sections, setSections] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [importing, setImporting] = useState<Record<string, unknown> | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const failed = (title: string) => (error: unknown) =>
    toast({
      title,
      description: error instanceof ApiError ? error.message : 'Network error',
      tone: 'danger',
    });

  // Read from this browser after hydration (the server has no localStorage).
  const browserCount = useSyncExternalStore(
    noSubscription,
    () => Object.keys(readBrowserOptions()).length,
    () => 0,
  );
  const layoutText =
    layout.hidden.length === 0 && layout.order.length === 0
      ? 'Every section, in the usual order.'
      : [
          layout.hidden.length > 0 ? `Hidden: ${layout.hidden.map(sectionTitle).join(', ')}.` : null,
          layout.order.length > 0 ? 'Your own order.' : null,
        ]
          .filter(Boolean)
          .join(' ');

  const download = () => {
    const data = exportPreferences(preferences.data?.preferences ?? {});
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `darkbeacon-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    const parsed = parsePreferencesFile(await picked.text());
    if (typeof parsed === 'string') toast({ title: 'Nothing imported', description: parsed, tone: 'danger' });
    else setImporting(parsed);
    if (file.current) file.current.value = '';
  };

  /** Replaces every area with the imported ones; areas the file lacks go back to defaults. */
  const apply = async (areas: Record<string, unknown>) => {
    const current = Object.keys(preferences.data?.preferences ?? {});
    const next: Record<string, unknown> = Object.fromEntries(current.map((area) => [area, null]));
    Object.assign(next, areas);
    await save(next);
    const browser = areas[BROWSER_AREA];
    writeBrowserOptions(
      typeof browser === 'object' && browser !== null ? (browser as Record<string, unknown>) : {},
      true,
    );
  };

  return (
    <Card>
      <CardHeader
        title="My preferences"
        description="Options that follow you to every browser you sign in on. Export them to keep a copy or move them to another instance."
      />
      <CardBody>
        <div className={styles.prefs}>
          <div className={styles.prefRow}>
            <div className={styles.prefText}>
              <strong>Sidebar sections</strong>
              <span className="muted">{layoutText}</span>
            </div>
            <Button size="sm" icon={<PanelRight />} onClick={() => setSections(true)}>
              Customize…
            </Button>
          </div>
          <div className={styles.prefGroup}>
            <strong>Local</strong>
            <Switch
              checked={local.showOffline}
              onCheckedChange={(showOffline) => setLocal({ showOffline })}
              label="Show offline pilots"
            />
            <Switch
              checked={local.showShipName}
              onCheckedChange={(showShipName) => setLocal({ showShipName })}
              label="Ship names instead of ship types"
            />
            <Switch
              checked={local.compact}
              onCheckedChange={(compact) => setLocal({ compact })}
              label="Compact list"
              description="One short line per pilot, without corporation and alliance."
            />
          </div>
          <p className={styles.prefNote}>
            {browserCount > 0
              ? `Also kept: ${browserCount} option${browserCount === 1 ? '' : 's'} set on the map in this browser (signature columns, the legend, kills and routes).`
              : 'Options you set on the map (signature columns, the legend, kills and routes) are kept here too.'}
          </p>
        </div>
      </CardBody>
      <CardFooter>
        <Button icon={<Download />} onClick={download} disabled={!preferences.data}>
          Export
        </Button>
        <Button icon={<Upload />} onClick={() => file.current?.click()}>
          Import…
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <span className={styles.spacer} />
        <Button variant="danger-ghost" icon={<RotateCcw />} onClick={() => setResetting(true)}>
          Reset…
        </Button>
      </CardFooter>
      <SectionsDialog open={sections} onOpenChange={setSections} />
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Reset my preferences?"
        description="The sidebar, Local, On the map and the options set on maps go back to their defaults, in every browser. Theme, default map and live cursors stay."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={() =>
          apply({}).then(
            () =>
              toast({
                title: 'Preferences reset',
                description: 'Reload open maps to see every default.',
                tone: 'success',
              }),
            failed('Could not reset'),
          )
        }
      />
      <ConfirmDialog
        open={importing !== null}
        onOpenChange={(open) => !open && setImporting(null)}
        title="Import these preferences?"
        description="They replace your current preferences in every browser."
        confirmLabel="Import"
        onConfirm={() =>
          importing
            ? apply(importing).then(
                () =>
                  toast({
                    title: 'Preferences imported',
                    description: 'Reload open maps to see them.',
                    tone: 'success',
                  }),
                failed('Could not import'),
              )
            : undefined
        }
      />
    </Card>
  );
}

const noSubscription = () => () => undefined;
