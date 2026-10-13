'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, LayoutGrid, RotateCcw, Upload } from 'lucide-react';
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
import { useLocalOptions } from '../map/widgets/LocalSection';
import { CORE_WIDGETS } from '../map/widgets/layout';
import { useWidgetsLayout } from '../map/widgets/useWidgetsLayout';
import { Button, Card, CardBody, CardFooter, CardHeader, ConfirmDialog, Switch, useToast } from '../ui';
import styles from './AccountPage.module.css';

/**
 * "My preferences": the options that follow me between browsers in one place, with export,
 * import and reset. Local and the map widgets are set here; the options other parts of the map
 * keep (signature columns, the legend, kills and routes) travel along from wherever they were set.
 */
export function MyPreferences() {
  const toast = useToast();
  const preferences = usePreferences();
  const save = useSavePreferences();
  const [local, setLocal] = useLocalOptions();
  const widgets = useWidgetsLayout();
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
          <div className={styles.prefGroup}>
            <div className={styles.prefRow}>
              <div className={styles.prefText}>
                <strong>Map widgets</strong>
                <span className="muted">
                  Windows over the map, each with one job. Drag them by the title, resize them from a corner;
                  where you leave them is kept.
                </span>
              </div>
              <Button size="sm" icon={<LayoutGrid />} onClick={widgets.reset}>
                Reset layout
              </Button>
            </div>
            {CORE_WIDGETS.map((w) => (
              <Switch
                key={w.id}
                checked={widgets.isVisible(w.id)}
                onCheckedChange={(on) => widgets.setShown(w.id, on)}
                label={w.title}
              />
            ))}
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
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Reset my preferences?"
        description="The map widgets, Local, On the map and the options set on maps go back to their defaults, in every browser. Theme, default map and live cursors stay."
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
