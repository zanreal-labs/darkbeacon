import { createElement, useEffect, useState } from 'react';
import type { HostReact, SlotComponent, WebPlugin, WebPluginApi, WebSlot } from '@darkbeacon/plugin-sdk';

/** The host React handed to plugins; they must not bundle a copy of their own. */
const hostReact = { createElement, useState, useEffect } as unknown as HostReact;

export interface SlotEntry<S extends WebSlot = WebSlot> {
  key: string;
  pluginId: string;
  component: SlotComponent<S>;
  title: string;
  order: number;
}

/** Components that plugins registered into the web slots. Observable for `useSyncExternalStore`. */
export class PluginRegistry {
  private readonly slots = new Map<WebSlot, SlotEntry[]>();
  private readonly listeners = new Set<() => void>();
  private readonly disabled = new Map<string, ReadonlySet<string>>();
  private counter = 0;

  /** Maps on which a plugin is switched off; its components are hidden there. */
  setDisabledMaps(pluginId: string, mapIds: readonly string[]): void {
    this.disabled.set(pluginId, new Set(mapIds));
    this.listeners.forEach((l) => l());
  }

  enabledOn(pluginId: string, mapId: string | null | undefined): boolean {
    return !mapId || !this.disabled.get(pluginId)?.has(mapId);
  }

  register<S extends WebSlot>(
    pluginId: string,
    slot: S,
    component: SlotComponent<S>,
    options: { title?: string; order?: number } = {},
  ): void {
    const entry: SlotEntry<S> = {
      key: `${pluginId}:${slot}:${++this.counter}`,
      pluginId,
      component,
      title: options.title ?? pluginId,
      order: options.order ?? 100,
    };
    const list = [...(this.slots.get(slot) ?? []), entry as unknown as SlotEntry];
    list.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    this.slots.set(slot, list);
    this.listeners.forEach((l) => l());
  }

  /** Same array until the slot changes, so it is safe as a `useSyncExternalStore` snapshot. */
  get<S extends WebSlot>(slot: S): readonly SlotEntry<S>[] {
    return (this.slots.get(slot) ?? EMPTY) as unknown as readonly SlotEntry<S>[];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  apiFor(pluginId: string): WebPluginApi {
    return {
      pluginId,
      react: hostReact,
      register: (slot, component, options) => this.register(pluginId, slot, component, options),
      fetch: (path, init) =>
        fetch(`/api/plugins/${encodeURIComponent(pluginId)}/${path.replace(/^\//, '')}`, {
          credentials: 'same-origin',
          ...init,
        }),
    };
  }
}

const EMPTY: readonly SlotEntry[] = [];

export type ModuleImporter = (url: string) => Promise<{ default?: WebPlugin }>;

const nativeImport: ModuleImporter = (url) =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);

/** Loads each plugin's web module and lets it register; one broken plugin does not stop the rest. */
export async function loadWebPlugins(
  registry: PluginRegistry,
  plugins: readonly { id: string; url: string; disabledMapIds?: readonly string[] }[],
  importer: ModuleImporter = nativeImport,
): Promise<{ id: string; error: string }[]> {
  const failures: { id: string; error: string }[] = [];
  await Promise.all(
    plugins.map(async ({ id, url, disabledMapIds }) => {
      try {
        registry.setDisabledMaps(id, disabledMapIds ?? []);
        const mod = await importer(url);
        if (!mod.default || typeof mod.default.register !== 'function') {
          throw new Error('the module has no default export from defineWebPlugin()');
        }
        await mod.default.register(registry.apiFor(id));
      } catch (error) {
        failures.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  return failures;
}
