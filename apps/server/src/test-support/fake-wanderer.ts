import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The map the fake serves: tools/fake-wanderer/map.json (Wanderer's rows) with real timestamps. */
export interface FakeWandererMap {
  map: { id: string; name: string; slug: string; description: string; scope: string };
  apiKey: string;
  systems: Array<Record<string, unknown> & { solar_system_id: number; visible: boolean; id: string }>;
  connections: Array<Record<string, unknown> & { solar_system_source: number; solar_system_target: number }>;
  signatures: Array<Record<string, unknown> & { eve_id: string; system_id: string; deleted: boolean }>;
  structures: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  passages: Array<Record<string, unknown>>;
  acls: Array<{ id: string; name: string; key: string | null; members: Array<Record<string, unknown>> }>;
}

export interface FakeWandererOptions {
  rateLimitEvery?: number;
  /** false: no `/api/maps/:map/export` (upstream Wanderer). */
  export?: boolean;
  /** false: webhooks switched off on the instance. */
  webhooks?: boolean;
}

interface FakeModule {
  loadMap(file?: string, now?: number): FakeWandererMap;
  createFakeWanderer(map: FakeWandererMap, options?: FakeWandererOptions & { log?: string[] }): Server;
}

const MODULE = pathToFileURL(resolve(import.meta.dirname, '../../../../tools/fake-wanderer/server.mjs')).href;

/** Starts the fake Wanderer instance (tools/fake-wanderer) on a free loopback port. */
export async function startFakeWanderer(
  options: FakeWandererOptions & { map?: FakeWandererMap } = {},
): Promise<{ url: string; map: FakeWandererMap; log: string[]; close(): Promise<void> }> {
  const fake = (await import(MODULE)) as FakeModule;
  const map = options.map ?? fake.loadMap();
  const log: string[] = [];
  const server = fake.createFakeWanderer(map, { ...options, log });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    map,
    log,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Loads the fake's map without serving it. */
export async function loadFakeWandererMap(): Promise<FakeWandererMap> {
  return ((await import(MODULE)) as FakeModule).loadMap();
}
