'use client';

import { useEffect, useRef, useState } from 'react';
import {
  destinationOfClass,
  type ConnectionDto,
  type MapSystemDto,
  type SignatureDto,
  type TypedEvent,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { useStream } from '../../lib/RealtimeProvider';
import { useMe } from '../../lib/session';
import { Button, Dialog, DialogClose, DialogContent } from '../../ui';
import { systemClass } from '../../lib/universe';
import { systemDisplayName } from '../SystemNode';
import type { MapStore } from '../useMapStore';
import { useBubbledBadges } from './BubbledBadge';
import { TypeLabel } from './catalog';
import { GROUP_LABEL, signatureLeadsTo } from './facts';
import { signaturePrefs } from './prefs';
import { OPEN_WORMHOLE_REFERENCE } from './SignatureSettingsMenu';
import { WormholeReference } from './WormholeReference';
import styles from './signatures.module.css';

/** Asks the map to offer the signatures of both ends of a connection for linking. */
export const LINK_CONNECTION = 'dbk:link-connection';
export const openLinkConnection = (connectionId: string) =>
  window.dispatchEvent(new CustomEvent(LINK_CONNECTION, { detail: { connectionId } }));

/** How long a jump of yours and the connection it made may lie apart. */
const SPLASH_WINDOW_MS = 30_000;

interface LinkPrompt {
  connectionId: string;
  /** Only this end (after a jump: where you came from); both ends when absent. */
  from?: number;
}

/** Signatures of `systemId` that can lead through `connection` and are not linked yet. */
export function linkCandidates(
  systemId: number,
  connection: ConnectionDto,
  signatures: Iterable<SignatureDto>,
  universe: Map<number, UniverseSystemDto>,
): SignatureDto[] {
  const otherId = connection.source === systemId ? connection.target : connection.source;
  const destination = destinationOfClass(universe.get(otherId)?.whClass);
  return [...signatures]
    .filter((s) => s.solarSystemId === systemId && !s.connectionId)
    .filter((s) => s.group === 'wormhole' || s.group === 'unknown')
    .filter((s) => {
      const goes = signatureLeadsTo(s);
      return !goes || !destination || goes.includes(destination);
    })
    .sort(
      (a, b) =>
        Number(b.group === 'wormhole') - Number(a.group === 'wormhole') || a.eveId.localeCompare(b.eveId),
    );
}

/**
 * Signature parts of the map that live outside the sidebar: the bubbled marker on nodes, the
 * wormhole types reference, the "link a signature" prompt for a connection (from its menu) and,
 * when the preference is on, after one of your jumps made a new connection (Wanderer's link
 * signature on splash).
 */
export function SignatureLayer({
  mapId,
  state,
  universe,
  store,
  canEdit,
}: {
  mapId: string;
  state: {
    systems: Map<number, MapSystemDto>;
    connections: Map<string, ConnectionDto>;
    signatures: Map<string, SignatureDto>;
  };
  universe: Map<number, UniverseSystemDto>;
  store: Pick<MapStore, 'updateSignature'>;
  canEdit: boolean;
}) {
  useBubbledBadges(mapId, state.signatures);
  const me = useMe();
  const [reference, setReference] = useState(false);
  const [prompt, setPrompt] = useState<LinkPrompt | null>(null);
  const jumps = useRef<{ from: number; to: number; at: number }[]>([]);
  const added = useRef<{ connectionId: string; source: number; target: number; at: number }[]>([]);

  useEffect(() => {
    const openReference = () => setReference(true);
    const openLink = (e: Event) => {
      const { connectionId } = (e as CustomEvent<{ connectionId: string }>).detail;
      setPrompt({ connectionId });
    };
    window.addEventListener(OPEN_WORMHOLE_REFERENCE, openReference);
    window.addEventListener(LINK_CONNECTION, openLink);
    return () => {
      window.removeEventListener(OPEN_WORMHOLE_REFERENCE, openReference);
      window.removeEventListener(LINK_CONNECTION, openLink);
    };
  }, []);

  // A jump of yours and the connection it made, in either order: offer the signatures of the
  // system you came from.
  const signaturesRef = useRef(state.signatures);
  const universeRef = useRef(universe);
  useEffect(() => {
    signaturesRef.current = state.signatures;
    universeRef.current = universe;
  });
  useStream(`map:${mapId}`, (message) => {
    if (message.op !== 'event' || !canEdit || !signaturePrefs().linkOnSplash) return;
    const event = message.event as TypedEvent;
    const now = Date.now();
    const mine = new Set(me.data?.characters.map((c) => c.id));
    const offer = (connection: { connectionId: string; source: number; target: number }, from: number) => {
      const found = {
        id: connection.connectionId,
        source: connection.source,
        target: connection.target,
        type: 'wormhole',
      } as ConnectionDto;
      if (linkCandidates(from, found, signaturesRef.current.values(), universeRef.current).length > 0)
        setPrompt({ connectionId: connection.connectionId, from });
    };
    if (event.type === 'character.jumped' && mine.has(event.data.characterId)) {
      const jump = { from: event.data.from, to: event.data.to, at: now };
      jumps.current = [...jumps.current.filter((j) => now - j.at < SPLASH_WINDOW_MS), jump];
      const made = added.current.find(
        (c) => now - c.at < SPLASH_WINDOW_MS && new Set([c.source, c.target, jump.from, jump.to]).size === 2,
      );
      if (made) offer(made, jump.from);
    } else if (event.type === 'connection.added' && event.data.type === 'wormhole') {
      const made = {
        connectionId: event.data.id,
        source: event.data.source,
        target: event.data.target,
        at: now,
      };
      added.current = [...added.current.filter((c) => now - c.at < SPLASH_WINDOW_MS), made];
      const jump = jumps.current.find(
        (j) => now - j.at < SPLASH_WINDOW_MS && new Set([made.source, made.target, j.from, j.to]).size === 2,
      );
      if (jump) offer(made, jump.from);
    }
  });

  const connection = prompt ? state.connections.get(prompt.connectionId) : undefined;
  const name = (id: number) => {
    const s = state.systems.get(id);
    return s ? systemDisplayName(s, universe.get(id)) : (universe.get(id)?.name ?? String(id));
  };

  return (
    <>
      <WormholeReference open={reference} onOpenChange={setReference} />
      {prompt && connection && (
        <LinkDialog
          connection={connection}
          ends={prompt.from ? [prompt.from] : [connection.source, connection.target]}
          signatures={state.signatures}
          universe={universe}
          name={name}
          splash={!!prompt.from}
          onLink={(signatureId) => void store.updateSignature(signatureId, { connectionId: connection.id })}
          onClose={() => setPrompt(null)}
        />
      )}
    </>
  );
}

function LinkDialog({
  connection,
  ends,
  signatures,
  universe,
  name,
  splash,
  onLink,
  onClose,
}: {
  connection: ConnectionDto;
  ends: number[];
  signatures: Map<string, SignatureDto>;
  universe: Map<number, UniverseSystemDto>;
  name(id: number): string;
  splash: boolean;
  onLink(signatureId: string): void;
  onClose(): void;
}) {
  const linked = (systemId: number) =>
    [...signatures.values()].find((s) => s.solarSystemId === systemId && s.connectionId === connection.id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={splash ? 'Which signature did you jump through?' : 'Link signatures'}
        description={`${name(connection.source)} ↔ ${name(connection.target)}`}
        width={460}
        footer={
          <DialogClose asChild>
            <Button variant="ghost">{splash ? 'Not now' : 'Done'}</Button>
          </DialogClose>
        }
      >
        {ends.map((systemId) => {
          const other = connection.source === systemId ? connection.target : connection.source;
          const pill = systemClass(universe.get(other));
          const current = linked(systemId);
          const candidates = linkCandidates(systemId, connection, signatures.values(), universe);
          return (
            <section key={systemId} aria-label={`Signatures in ${name(systemId)}`}>
              <p className={styles.muted}>
                In {name(systemId)}, leading to{' '}
                <span style={{ color: cssVar(pill.token) }}>{pill.label}</span> {name(other)}
                {current && (
                  <>
                    {' '}
                    · linked: <strong>{current.eveId}</strong>
                  </>
                )}
              </p>
              {candidates.length === 0 ? (
                <p className={styles.muted}>No unlinked wormhole signature fits.</p>
              ) : (
                <ul className={styles.linkList}>
                  {candidates.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={styles.linkChoice}
                        onClick={() => {
                          onLink(s.id);
                          if (splash || ends.length === 1) onClose();
                        }}
                      >
                        <span className={styles.sigCode}>{s.eveId}</span>
                        {s.type ? (
                          <TypeLabel code={s.type.toUpperCase()} destination={s.destination} />
                        ) : (
                          <span className={styles.muted}>{GROUP_LABEL[s.group]}</span>
                        )}
                        {s.tempName && <strong>{s.tempName}</strong>}
                        {s.description && <span className={styles.muted}>{s.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
