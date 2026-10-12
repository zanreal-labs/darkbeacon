'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Eye, Link2Off } from 'lucide-react';
import type { LabelDto, PublicMapViewDto, TypedEvent, UniverseSystemDto } from '@darkbeacon/shared';
import { fetchPublicView } from '../lib/public-map';
import type { StreamMessage } from '../lib/realtime';
import { useStream } from '../lib/RealtimeProvider';
import { notSharedSentence } from '../lib/share-scopes';
import { applyMapMessage, emptyMapState, type MapState } from '../map/mapState';
import { ConnectionIndicator } from '../shell/ConnectionIndicator';
import { LogoMark } from '../shell/Logo';
import { Badge, Button, EmptyState, Spinner } from '../ui';
import styles from './PublicMap.module.css';

/** What the public canvas paints until React Flow's code arrived (and on the server). */
export function PublicCanvasLoading() {
  return (
    <div className={styles.center} role="status">
      <Spinner label="Loading map" />
      <span>Loading map…</span>
    </div>
  );
}

// React Flow measures the window, so the canvas renders in the browser only (as on /m/<slug>).
const PublicCanvas = dynamic(() => import('./PublicMapCanvas').then((m) => m.PublicMapCanvas), {
  ssr: false,
  loading: () => <PublicCanvasLoading />,
});

/** `/p/<token>` while the view streams in from the server. */
export function PublicMapLoading() {
  return (
    <div className={styles.page} aria-busy="true">
      <header className={styles.bar}>
        <span className={styles.brand} aria-hidden>
          <LogoMark size={22} />
        </span>
      </header>
      <div className={styles.canvasArea}>
        <PublicCanvasLoading />
      </div>
    </div>
  );
}

/** The link is unknown, switched off, replaced by a new one, or public maps are off. */
export function PublicMapGone() {
  return (
    <main className={styles.standalone}>
      <EmptyState
        icon={<Link2Off />}
        title="This link no longer works"
        description="The map's admin switched the link off or made a new one. Ask them for the current link."
        actions={
          <Button asChild>
            <a href="/">Open Darkbeacon</a>
          </Button>
        }
      />
    </main>
  );
}

/** The server could not read the link right now (busy, restarting): try again. */
export function PublicMapUnavailable({ message }: { message: string }) {
  return (
    <main className={styles.standalone}>
      <EmptyState
        tone="danger"
        icon={<Link2Off />}
        title="The map could not be loaded"
        description={message}
        actions={
          <Button asChild>
            <a href="">Try again</a>
          </Button>
        }
      />
    </main>
  );
}

function stateOf(view: PublicMapViewDto): MapState {
  return applyMapMessage(emptyMapState(), {
    op: 'snapshot',
    stream: view.stream,
    seq: view.seq,
    data: view.snapshot,
  });
}

/** Follows the public stream from `seq`; remounted (new key) to follow it again after a re-read. */
function Follow({
  stream,
  seq,
  onMessage,
}: {
  stream: string;
  seq: number;
  onMessage(message: StreamMessage): void;
}) {
  useStream(stream, onMessage, seq);
  return null;
}

/**
 * A public map, read-only and live: the server-rendered view, then the public stream on the one
 * WebSocket (anonymous). No account, no presence, nothing that edits. When the link changes the
 * view is read again; when it stops working the page says so.
 */
export function PublicMapScreen({ token, view: initial }: { token: string; view: PublicMapViewDto }) {
  const [view, setView] = useState(initial);
  const [state, setState] = useState(() => stateOf(initial));
  const [labels, setLabels] = useState<LabelDto[]>(initial.map.labels);
  const [gone, setGone] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const reading = useRef(false);
  const universe = useMemo(
    () => new Map<number, UniverseSystemDto>(view.universe.map((s) => [s.id, s])),
    [view.universe],
  );

  /** Reads the whole view again (link changed, new systems, the stream ended). */
  const reread = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const next = await fetchPublicView(token);
      if (!next) {
        setGone(true);
        return;
      }
      setView(next);
      setState(stateOf(next));
      setLabels(next.map.labels);
      setEpoch((e) => e + 1);
    } catch {
      // The next event or reconnect tries again; the map stays as it was.
    } finally {
      reading.current = false;
    }
  }, [token]);

  const onMessage = (message: StreamMessage) => {
    if (message.op === 'error') {
      void reread();
      return;
    }
    if (message.op === 'snapshot') {
      // Systems without static data (names, classes) come with a fresh read of the view.
      const systems = (message.data as { systems?: { solarSystemId: number }[] }).systems ?? [];
      if (systems.some((s) => !universe.has(s.solarSystemId))) void reread();
      setState((s) => applyMapMessage(s, message));
      return;
    }
    if (message.op !== 'event') return;
    const event = message.event as TypedEvent;
    switch (event.type) {
      case 'access.public_link_changed':
      case 'map.sources_changed':
        void reread();
        return;
      case 'map.removed':
        setGone(true);
        return;
      case 'labels.changed':
        setLabels(event.data.labels);
        return;
      case 'system.added':
        if (!universe.has(event.data.solarSystemId)) void reread();
        break;
    }
    setState((s) => applyMapMessage(s, message));
  };

  if (gone) return <PublicMapGone />;
  const hidden = notSharedSentence(view.map.scopes);
  return (
    <div className={styles.page}>
      <Follow key={epoch} stream={view.stream} seq={view.seq} onMessage={onMessage} />
      <header className={styles.bar}>
        <span className={styles.brand} title="Darkbeacon">
          <LogoMark size={22} />
          <span className="sr-only">Darkbeacon</span>
        </span>
        <h1 className={styles.name} title={view.map.name}>
          {view.map.name}
        </h1>
        <Badge variant="outline" icon={<Eye />}>
          Read-only public view
        </Badge>
        <span className={styles.spacer} />
        <ConnectionIndicator />
        {hidden && <p className={styles.note}>{hidden}.</p>}
      </header>
      <div className={styles.canvasArea}>
        <PublicCanvas mapId={view.map.id} state={state} labels={labels} universe={universe} />
        {state.systems.size === 0 && (
          <div className={styles.overlay}>
            <EmptyState
              compact
              icon={<Eye />}
              title="Nothing on this map yet"
              description="Systems show up here as soon as the map's pilots add them."
            />
          </div>
        )}
      </div>
    </div>
  );
}
