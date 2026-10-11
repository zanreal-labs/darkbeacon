import type { SlotComponent, WebPlugin, WebPluginApi, WebSlot } from '@wormwright/plugin-sdk';

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
  private counter = 0;

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

const nativeImport: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/** Loads each plugin's web module and lets it register; one broken plugin does not stop the rest. */
export async function loadWebPlugins(
  registry: PluginRegistry,
  plugins: readonly { id: string; url: string }[],
  importer: ModuleImporter = nativeImport,
): Promise<{ id: string; error: string }[]> {
  const failures: { id: string; error: string }[] = [];
  await Promise.all(
    plugins.map(async ({ id, url }) => {
      try {
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
