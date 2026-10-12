'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { RealtimeClient, defaultRealtimeUrl, type ConnectionStatus, type StreamListener } from './realtime';

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** `client` replaces the default socket, e.g. with a fake one in tests. */
export function RealtimeProvider({
  children,
  client: given,
}: {
  children: ReactNode;
  client?: RealtimeClient;
}) {
  // Rendered on the server too, where there is no socket to open; the client is only started in the browser.
  const [client] = useState(
    () =>
      given ??
      new RealtimeClient({
        url: typeof window === 'undefined' ? 'ws://server/ws' : defaultRealtimeUrl(window.location),
      }),
  );
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

/** The client, or null outside a RealtimeProvider (session hooks use it to re-authenticate). */
export function useOptionalRealtime(): RealtimeClient | null {
  return useContext(RealtimeContext);
}

export function useRealtime(): RealtimeClient {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error('useRealtime outside RealtimeProvider');
  return client;
}

/**
 * Follows a stream while mounted. `stream` null = not yet known (e.g. map still loading).
 * `sinceSeq`: the seq of a snapshot the page was rendered with; only later events are replayed.
 */
export function useStream(stream: string | null, listener: StreamListener, sinceSeq?: number): void {
  const client = useRealtime();
  const latest = useRef(listener);
  const resumeFrom = useRef(sinceSeq);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    if (!stream) return;
    return client.subscribe(stream, (message) => latest.current(message), resumeFrom.current);
  }, [client, stream]);
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useRealtime();
  return useSyncExternalStore(
    (notify) => client.onStatus(notify),
    () => client.status,
    // The prerendered shell shows the socket as about to connect.
    () => 'connecting',
  );
}
