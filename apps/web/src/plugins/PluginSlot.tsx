import * as React from 'react';
import {
  Component,
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WebSlot, WebSlotProps } from '@wormwright/plugin-sdk';
import { routes } from '@wormwright/shared';
import { api } from '../lib/api';
import { loadWebPlugins, PluginRegistry, type SlotEntry } from './registry';

const RegistryContext = createContext(new PluginRegistry());

declare global {
  // The host React instance for plugin web modules, which must not bundle their own.
  var wormwright: { react: typeof React } | undefined;
}

/** Loads enabled web plugins once a user is signed in and provides their slot components. */
export function PluginsProvider({
  enabled,
  registry: given,
  children,
}: {
  enabled: boolean;
  registry?: PluginRegistry;
  children: ReactNode;
}) {
  const [registry] = useState(() => given ?? new PluginRegistry());
  const list = useQuery({
    queryKey: ['web-plugins'],
    queryFn: () => api<{ id: string; url: string }[]>(routes.plugins.web.path),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!list.data?.length) return;
    globalThis.wormwright ??= { react: React };
    void loadWebPlugins(registry, list.data).then((failures) => {
      for (const f of failures) console.warn(`plugin ${f.id} failed to load: ${f.error}`);
    });
  }, [registry, list.data]);
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

export function useSlot<S extends WebSlot>(slot: S): readonly SlotEntry<S>[] {
  const registry = useContext(RegistryContext);
  return useSyncExternalStore(registry.subscribe, () => registry.get(slot));
}

class PluginBoundary extends Component<{ pluginId: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(`plugin ${this.props.pluginId} crashed`, error, info.componentStack);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Renders one registered component; a crashing plugin renders nothing instead of the app failing. */
export function SlotItem<S extends WebSlot>({
  entry,
  props,
}: {
  entry: SlotEntry<S>;
  props: WebSlotProps[S];
}) {
  return (
    <PluginBoundary pluginId={entry.pluginId}>
      {createElement(entry.component as unknown as ComponentType<WebSlotProps[S]>, props)}
    </PluginBoundary>
  );
}

/** Every component registered for `slot`, in order. */
export function PluginSlot<S extends WebSlot>({ slot, props }: { slot: S; props: WebSlotProps[S] }) {
  const entries = useSlot(slot);
  return (
    <>
      {entries.map((entry) => (
        <SlotItem key={entry.key} entry={entry} props={props} />
      ))}
    </>
  );
}
