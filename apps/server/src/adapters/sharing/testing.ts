// Test helpers for the sharing adapters. Not used at runtime.
import type { Database } from '@darkbeacon/db';
import {
  ChainOverlaySlot,
  ConnectionUseCases,
  MapSnapshotQuery,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
} from '@darkbeacon/mapping';
import { mapStream } from '@darkbeacon/core';
import type { CharacterPresenceDto } from '@darkbeacon/shared';
import {
  ChainMerger,
  ChainWrites,
  SharingFeed,
  SharingUseCases,
  type SharingPorts,
} from '@darkbeacon/sharing';
import { KyselyEventLog } from '../events/kysely-event-log.js';
import { mappingTestPorts } from '../mapping/testing.js';
import { AsyncAuditScope } from '../../platform/audit.js';
import {
  KyselyChainLayoutRepository,
  KyselyChainViewRepository,
  KyselyCompositeMaps,
  KyselyLocalFieldsRepository,
  KyselyShareRepository,
} from './kysely-sharing.js';
import { LocalChainSources } from './local-chain-source.js';

/** Mapping and sharing over one database, wired as the server wires them, with a way to wait for merges. */
export function sharingTestEnv(database: Database) {
  const env = mappingTestPorts(database);
  const audit = new AsyncAuditScope();
  env.ports.events = new KyselyEventLog(database, env.bus, { scope: audit });
  const overlay = new ChainOverlaySlot();
  env.ports.overlay = overlay;
  const tracked = new Map<string, CharacterPresenceDto[]>();
  const characters = { forMap: (mapId: string) => Promise.resolve(tracked.get(mapId) ?? []) };
  const ports: SharingPorts = {
    shares: new KyselyShareRepository(database),
    sources: new LocalChainSources({ ports: env.ports, characters, audit }),
    views: new KyselyChainViewRepository(database),
    layout: new KyselyChainLayoutRepository(database),
    local: new KyselyLocalFieldsRepository(database),
    composites: new KyselyCompositeMaps(database),
    access: env.access,
    events: env.ports.events,
    uow: database,
    clock: env.clock,
    audit,
  };
  const merger = new ChainMerger(ports);
  overlay.use({ view: (mapId) => merger.chain(mapId) });
  const feed = new SharingFeed(ports, merger);
  const pending: Promise<void>[] = [];
  env.bus.subscribe((event) => {
    pending.push(feed.handle(event));
  });

  /** Waits until every published change has reached the maps merging it. */
  const settle = async () => {
    for (let round = 0; round < 50; round++) {
      await new Promise((resolve) => setImmediate(resolve));
      const waiting = pending.splice(0);
      if (waiting.length === 0) {
        await merger.idle();
        if (pending.length === 0) return;
        continue;
      }
      await Promise.all(waiting);
      await merger.idle();
    }
    throw new Error('merges did not settle');
  };

  const events = async (mapId: string, sinceSeq = 0) =>
    env.ports.events.readSince(mapStream(mapId), sinceSeq);

  return {
    ...env,
    audit,
    tracked,
    sharingPorts: ports,
    merger,
    settle,
    events,
    maps: new MapUseCases(env.ports),
    systems: new SystemUseCases(env.ports),
    connections: new ConnectionUseCases(env.ports),
    signatures: new SignatureUseCases(env.ports),
    snapshots: new MapSnapshotQuery(env.ports),
    sharing: new SharingUseCases(ports, merger),
    writes: new ChainWrites(ports, merger),
  };
}
