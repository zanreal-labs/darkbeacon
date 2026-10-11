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
  const [client] = useState(() => given ?? new RealtimeClient({ url: defaultRealtimeUrl(window.location) }));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeClient {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error('useRealtime outside RealtimeProvider');
  return client;
}

/** Follows a stream while mounted. `stream` null = not yet known (e.g. map still loading). */
export function useStream(stream: string | null, listener: StreamListener): void {
  const client = useRealtime();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    if (!stream) return;
    return client.subscribe(stream, (message) => latest.current(message));
  }, [client, stream]);
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useRealtime();
  return useSyncExternalStore(
    (notify) => client.onStatus(notify),
    () => client.status,
  );
}
