import type { DomainEvent } from '@darkbeacon/core';
import type {
  CharacterPresenceDto,
  ConnectionDto,
  LabelDto,
  MapExitDto,
  MapSystemDto,
  PublicSnapshotDto,
  ShareScope,
  SignatureDto,
} from '@darkbeacon/shared';

/**
 * What leaves the server for a public view. Everything is a whitelist: a field or event that is
 * not named here is never sent, and a field a scope does not share is blanked to its neutral
 * value (empty notes, `unknown` status, no labels) so the DTO keeps its shape and the map canvas
 * renders it as it renders any map, but the value never leaves.
 */
export type Scopes = ReadonlySet<ShareScope>;

export const has = (scopes: Scopes, scope: ShareScope) => scopes.has(scope);

export function projectSystem(system: MapSystemDto, scopes: Scopes): MapSystemDto {
  const intel = has(scopes, 'intel');
  return {
    mapId: system.mapId,
    solarSystemId: system.solarSystemId,
    position: system.position,
    customName: intel ? system.customName : null,
    temporaryName: intel ? system.temporaryName : null,
    tag: intel ? system.tag : null,
    status: intel ? system.status : 'unknown',
    description: intel ? system.description : '',
    labelIds: has(scopes, 'labels') ? system.labelIds : [],
    locked: false,
    visible: system.visible,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
}

export function projectConnection(connection: ConnectionDto, scopes: Scopes): ConnectionDto {
  const status = has(scopes, 'connectionStatus');
  const intel = has(scopes, 'intel');
  return {
    id: connection.id,
    mapId: connection.mapId,
    source: connection.source,
    target: connection.target,
    type: connection.type,
    timeStatus: status ? connection.timeStatus : 'normal',
    massStatus: status ? connection.massStatus : 'fresh',
    shipSize: status ? connection.shipSize : 'large',
    massSaved: status ? connection.massSaved : false,
    dangerous: intel ? connection.dangerous : false,
    bubbled: intel ? connection.bubbled : 'none',
    eolAt: status ? connection.eolAt : null,
    ...(status && connection.massStatusAt !== undefined ? { massStatusAt: connection.massStatusAt } : {}),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export function projectSignature(signature: SignatureDto, scopes: Scopes): SignatureDto {
  return {
    id: signature.id,
    mapId: signature.mapId,
    solarSystemId: signature.solarSystemId,
    eveId: signature.eveId,
    group: signature.group,
    type: signature.type,
    name: signature.name,
    description: has(scopes, 'intel') ? signature.description : '',
    connectionId: signature.connectionId,
    createdAt: signature.createdAt,
    updatedAt: signature.updatedAt,
  };
}

export function projectCharacter(character: CharacterPresenceDto): CharacterPresenceDto {
  return {
    characterId: character.characterId,
    // The account behind a character stays private; the field keeps its shape.
    accountId: 'public',
    name: character.name,
    solarSystemId: character.solarSystemId,
    shipTypeId: character.shipTypeId,
    shipName: character.shipName,
    online: character.online,
    updatedAt: character.updatedAt,
  };
}

/** Exits are topology; the distances to the map's own hubs (where the group stages) are intel. */
export function projectExit(exit: MapExitDto, scopes: Scopes): MapExitDto {
  if (has(scopes, 'intel')) return exit;
  const hubs = exit.hubs.filter((h) => h.kind === 'trade' || h.kind === 'staging');
  // `hubs` is nearest first, so the nearest shared hub is the first one left.
  return { ...exit, hubs, nearest: hubs[0] ?? null };
}

export function projectLabels(labels: readonly LabelDto[], scopes: Scopes): LabelDto[] {
  return has(scopes, 'labels')
    ? labels.map((l) => ({ id: l.id, name: l.name, color: l.color, description: l.description }))
    : [];
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** A map snapshot (as the realtime providers build it) cut down to what the scopes share. */
export function projectSnapshot(data: Record<string, unknown>, scopes: Scopes): PublicSnapshotDto {
  const systems = asArray<MapSystemDto>(data.systems).map((s) => projectSystem(s, scopes));
  const snapshot: PublicSnapshotDto = {
    systems,
    connections: asArray<ConnectionDto>(data.connections).map((c) => projectConnection(c, scopes)),
  };
  if (Array.isArray(data.exits))
    snapshot.exits = asArray<MapExitDto>(data.exits).map((e) => projectExit(e, scopes));
  if (has(scopes, 'signatures') && Array.isArray(data.signatures))
    snapshot.signatures = asArray<SignatureDto>(data.signatures).map((s) => projectSignature(s, scopes));
  if (has(scopes, 'characters') && Array.isArray(data.characters))
    snapshot.characters = asArray<CharacterPresenceDto>(data.characters).map(projectCharacter);
  return snapshot;
}

/** The actor public viewers see on every event: nobody in particular. */
export const PUBLIC_EVENT_ACTOR = { kind: 'system' as const, id: 'darkbeacon' };

/**
 * A map event as a public viewer receives it on `stream`, or null when the scopes do not share
 * it. Unknown event types are never forwarded.
 */
export function projectEvent(event: DomainEvent, scopes: Scopes, stream: string): DomainEvent | null {
  const forward = (data: unknown): DomainEvent => ({
    id: event.id,
    seq: event.seq,
    stream,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: PUBLIC_EVENT_ACTOR,
    data,
    v: 1,
  });
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'system.added':
    case 'system.updated':
      return forward(projectSystem(event.data as MapSystemDto, scopes));
    case 'system.removed':
      return forward({ solarSystemId: d.solarSystemId });
    case 'connection.added':
    case 'connection.updated':
      return forward(projectConnection(event.data as ConnectionDto, scopes));
    case 'connection.removed':
      return forward({ id: d.id });
    case 'signature.added':
    case 'signature.updated':
      return has(scopes, 'signatures') ? forward(projectSignature(event.data as SignatureDto, scopes)) : null;
    case 'signature.removed':
      return has(scopes, 'signatures') ? forward({ id: d.id, solarSystemId: d.solarSystemId }) : null;
    case 'character.tracked':
      return has(scopes, 'characters') ? forward(projectCharacter(event.data as CharacterPresenceDto)) : null;
    case 'character.untracked':
    case 'character.online_changed':
    case 'character.moved':
    case 'character.ship_changed':
      return has(scopes, 'characters') ? forward(d) : null;
    case 'labels.changed':
      return has(scopes, 'labels')
        ? forward({ labels: projectLabels(asArray<LabelDto>(d.labels), scopes) })
        : null;
    case 'routes.exits_changed':
      return forward({ exits: asArray<MapExitDto>(d.exits).map((e) => projectExit(e, scopes)) });
    case 'map.removed':
      return forward({ id: d.id });
    case 'access.sharing_changed':
      // What the link shows changed (or the link itself): viewers read the view again. Nothing
      // of the settings is sent.
      return forward({});
    default:
      // character.jumped and connection.passage name ships and pilots; settings, access,
      // pings, hubs and plugin events are never public.
      return null;
  }
}
