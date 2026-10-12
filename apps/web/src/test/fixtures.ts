import type { MeDto, ConnectionDto, MapSystemDto, SignatureDto } from '@wormwright/shared';

export const MAP_ID = 'map-1';

export function systemFixture(solarSystemId: number, extra: Partial<MapSystemDto> = {}): MapSystemDto {
  return {
    mapId: MAP_ID,
    solarSystemId,
    position: { x: 0, y: 0 },
    customName: null,
    temporaryName: null,
    tag: null,
    status: 'unknown',
    description: '',
    labelIds: [],
    locked: false,
    visible: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

export function connectionFixture(
  id: string,
  source: number,
  target: number,
  extra: Partial<ConnectionDto> = {},
): ConnectionDto {
  return {
    id,
    mapId: MAP_ID,
    source,
    target,
    type: 'wormhole',
    timeStatus: 'normal',
    massStatus: 'fresh',
    shipSize: 'large',
    massSaved: false,
    dangerous: false,
    bubbled: 'none',
    eolAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

export function signatureFixture(
  id: string,
  solarSystemId: number,
  eveId: string,
  extra: Partial<SignatureDto> = {},
): SignatureDto {
  return {
    id,
    mapId: MAP_ID,
    solarSystemId,
    eveId,
    group: 'unknown',
    type: null,
    name: null,
    description: '',
    connectionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

let seq = 0;
/** A stream event with an increasing seq; pair it with a snapshot at seq 0. */
export function eventMessage(stream: string, type: string, data: unknown, at = Date.now()) {
  seq += 1;
  return {
    op: 'event',
    event: {
      id: `e${seq}`,
      seq,
      stream,
      type,
      occurredAt: at,
      actor: { kind: 'system', id: 'test' },
      data,
      v: 1,
    },
  };
}

export function meFixture(): MeDto {
  return {
    account: {
      id: 'acc-demo',
      discordId: null,
      name: 'Demo pilot',
      avatarUrl: null,
      instanceRole: 'owner',
      mainCharacterId: 3_900_000_001,
      createdAt: 0,
    },
    characters: [
      {
        id: 3_900_000_001,
        name: 'Ayla Vex',
        corporationId: 1000169,
        allianceId: null,
        tokenValid: true,
        linkedAt: 0,
      },
    ],
  };
}
