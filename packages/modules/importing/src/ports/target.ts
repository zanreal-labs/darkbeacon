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
  SystemLabelDto,
} from '@darkbeacon/shared';
import type { ConnectionWrite, SignatureWrite, SystemWrite } from '../domain/decide.js';

export type WriteOutcome = 'created' | 'updated' | 'unchanged';

export interface TargetMap {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Tags. */
  labels: LabelDto[];
  /** Labels (WH1, A, B...). */
  systemLabels: SystemLabelDto[];
  settings: MapSettings;
  /** `composite` maps only show other maps' chains; nothing is imported into them. */
  kind: 'map' | 'composite';
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
    changedAt?: number,
  ): Promise<{ system: MapSystemDto; outcome: WriteOutcome }>;
  putConnection(
    actor: Actor,
    mapId: string,
    pair: { source: number; target: number },
    fields: ConnectionWrite,
    createdAt?: number,
    changedAt?: number,
  ): Promise<{ connection: ConnectionDto; outcome: WriteOutcome }>;
  putSignature(
    actor: Actor,
    mapId: string,
    solarSystemId: number,
    eveId: string,
    fields: SignatureWrite,
    createdAt?: number,
    changedAt?: number,
  ): Promise<{ signature: SignatureDto; outcome: WriteOutcome }>;
  /** Records a passage once per `externalId`; `skipped` when the map does not connect the pair. */
  putPassage(
    actor: Actor,
    mapId: string,
    passage: {
      source: number;
      target: number;
      characterId: number;
      shipTypeId: number | null;
      occurredAt: number;
    },
    externalId: string,
  ): Promise<'created' | 'unchanged' | 'skipped'>;
  /** Adds the Tags the map lacks by name. */
  ensureLabels(actor: Actor, mapId: string, labels: ReadonlyArray<Omit<LabelDto, 'id'>>): Promise<LabelDto[]>;
  /** The map's Labels: `replace` makes the list exactly `labels`, else missing names are added. */
  ensureSystemLabels(
    actor: Actor,
    mapId: string,
    labels: readonly SystemLabelDto[],
    options: { replace: boolean },
  ): Promise<SystemLabelDto[]>;
  setScopes(actor: Actor, mapId: string, scopes: MapScope[]): Promise<void>;
  /** The map's description (map admins). */
  setDescription(actor: Actor, mapId: string, description: string): Promise<void>;
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

/** The map's webhooks, through the notifications module (map admins only). */
export interface WebhookTarget {
  /** Ids of the map's webhooks. */
  ids(actor: Actor, mapId: string): Promise<string[]>;
  /** Adds a webhook switched off; returns its id. */
  addDisabled(actor: Actor, mapId: string, webhook: { url: string; events: string[] }): Promise<string>;
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
