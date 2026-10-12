import type { Actor } from '@darkbeacon/core';
import type {
  AccessRuleDto,
  ConnectionDto,
  LabelDto,
  MapRole,
  MapScope,
  MapSettings,
  MapSystemDto,
  SignatureDto,
} from '@darkbeacon/shared';
import type { ConnectionWrite, SignatureWrite, SystemWrite } from '../domain/decide.js';

export type WriteOutcome = 'created' | 'updated' | 'unchanged';

export interface TargetMap {
  id: string;
  slug: string;
  name: string;
  labels: LabelDto[];
  settings: MapSettings;
}

/**
 * The map an import writes into, through the mapping and routing use cases: every write is
 * authorised for `actor`, evented and audited like an edit in the web app.
 */
export interface ChainTarget {
  createMap(actor: Actor, request: { name: string; slug?: string }): Promise<TargetMap>;
  map(actor: Actor, mapId: string): Promise<TargetMap>;
  roleOf(actor: Actor, mapId: string): Promise<MapRole | null>;
  /** Every system, hidden ones included. */
  systems(actor: Actor, mapId: string): Promise<MapSystemDto[]>;
  connections(actor: Actor, mapId: string): Promise<ConnectionDto[]>;
  /** Every signature, those of hidden systems included. */
  signatures(actor: Actor, mapId: string): Promise<SignatureDto[]>;
  putSystem(
    actor: Actor,
    mapId: string,
    solarSystemId: number,
    fields: SystemWrite,
    createdAt?: number,
  ): Promise<{ system: MapSystemDto; outcome: WriteOutcome }>;
  putConnection(
    actor: Actor,
    mapId: string,
    pair: { source: number; target: number },
    fields: ConnectionWrite,
    createdAt?: number,
  ): Promise<{ connection: ConnectionDto; outcome: WriteOutcome }>;
  putSignature(
    actor: Actor,
    mapId: string,
    solarSystemId: number,
    eveId: string,
    fields: SignatureWrite,
    createdAt?: number,
  ): Promise<{ signature: SignatureDto; outcome: WriteOutcome }>;
  ensureLabels(actor: Actor, mapId: string, labels: ReadonlyArray<Omit<LabelDto, 'id'>>): Promise<LabelDto[]>;
  setScopes(actor: Actor, mapId: string, scopes: MapScope[]): Promise<void>;
  hideSystem(actor: Actor, mapId: string, solarSystemId: number): Promise<void>;
  removeConnection(actor: Actor, mapId: string, connectionId: string): Promise<void>;
  removeSignature(actor: Actor, mapId: string, signatureId: string): Promise<void>;
  hubs(actor: Actor, mapId: string): Promise<number[]>;
  setHubs(actor: Actor, mapId: string, solarSystemIds: number[]): Promise<void>;
}

/** The map's access rules, through the access module's use cases (map admins only). */
export interface AccessTarget {
  list(actor: Actor, mapId: string): Promise<AccessRuleDto[]>;
  add(
    actor: Actor,
    mapId: string,
    rule: { subjectKind: 'character' | 'corporation' | 'alliance'; subjectId: string; role: MapRole },
  ): Promise<AccessRuleDto>;
  remove(actor: Actor, mapId: string, ruleId: string): Promise<void>;
}

export interface EveName {
  name: string;
  category: string;
  ticker: string | null;
}

/** Names of EVE characters, corporations and alliances (ESI), for the preview. */
export interface EveNames {
  /** Names it found; ids ESI does not know are left out. Never throws. */
  describe(ids: readonly number[]): Promise<Map<number, EveName>>;
}

/** Real names of solar systems (static game data). */
export interface SystemNames {
  systemName(solarSystemId: number): string | null;
}
