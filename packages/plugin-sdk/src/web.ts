/** Named places in the web app where plugins render components. */
export const WEB_SLOTS = [
  'widget',
  'systemContextMenu',
  'connectionContextMenu',
  'nodeBadge',
  'edgeBadge',
  'settingsPage',
] as const;
export type WebSlot = (typeof WEB_SLOTS)[number];

/** Props each slot passes to its components. */
export interface WebSlotProps {
  widget: { mapId: string };
  systemContextMenu: { mapId: string; solarSystemId: number; close(): void };
  connectionContextMenu: { mapId: string; connectionId: string; close(): void };
  nodeBadge: { mapId: string; solarSystemId: number };
  edgeBadge: { mapId: string; connectionId: string };
  settingsPage: { mapId: string | null };
}

/**
 * A React component, typed loosely so the SDK does not depend on React; the host renders it
 * with the host's React instance.
 */
export type SlotComponent<S extends WebSlot> = (props: WebSlotProps[S]) => unknown;

export interface WebPluginApi {
  readonly pluginId: string;
  register<S extends WebSlot>(
    slot: S,
    component: SlotComponent<S>,
    options?: { title?: string; order?: number },
  ): void;
  /** Calls the plugin's own routes under /api/plugins/<id>. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export interface WebPlugin {
  register(api: WebPluginApi): void | Promise<void>;
}

/** Default export of a plugin's web entry. */
export function defineWebPlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}
