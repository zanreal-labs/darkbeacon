import type {
  AccessRuleDto,
  AdminAccountDto,
  CharacterPresenceDto,
  ConnectionDto,
  LabelDto,
  MapDto,
  MapRole,
  MapSystemDto,
  MeDto,
  PluginDto,
  SignatureDto,
  UniverseSystemDto,
} from '@wormwright/shared';

/**
 * Sample data for the mocked API (`vite --mode mock` and tests). Wormhole names are made up;
 * this is not a source of game facts.
 */
export const UNIVERSE: UniverseSystemDto[] = [
  {
    id: 30000142,
    name: 'Jita',
    regionName: 'The Forge',
    constellationName: 'Kimotoro',
    security: 0.946,
    whClass: 7,
  },
  {
    id: 30000144,
    name: 'Perimeter',
    regionName: 'The Forge',
    constellationName: 'Kimotoro',
    security: 0.957,
    whClass: 7,
  },
  {
    id: 30002187,
    name: 'Amarr',
    regionName: 'Domain',
    constellationName: 'Throne Worlds',
    security: 1,
    whClass: 7,
  },
  {
    id: 30002659,
    name: 'Dodixie',
    regionName: 'Sinq Laison',
    constellationName: 'Botane',
    security: 0.87,
    whClass: 7,
  },
  {
    id: 30002510,
    name: 'Rens',
    regionName: 'Heimatar',
    constellationName: 'Frar',
    security: 0.9,
    whClass: 7,
  },
  {
    id: 30090001,
    name: 'Sample Low',
    regionName: 'Sample Region',
    constellationName: 'Sample',
    security: 0.3,
    whClass: 8,
  },
  {
    id: 30090002,
    name: 'Sample Null',
    regionName: 'Sample Region',
    constellationName: 'Sample',
    security: -0.4,
    whClass: 9,
  },
  {
    id: 31000005,
    name: 'Thera',
    regionName: 'G-R00031',
    constellationName: 'G-C00311',
    security: -0.99,
    whClass: 12,
  },
  ...[1, 2, 3, 4, 5, 6].flatMap((c) =>
    [1, 2].map((n) => ({
      id: 31090000 + c * 10 + n,
      name: `J1${c}000${n}`,
      regionName: `${'ABCDEF'[c - 1]}-R0000${c}`,
      constellationName: `${'ABCDEF'[c - 1]}-C0000${n}`,
      security: -0.99,
      whClass: c,
    })),
  ),
];

const now = Date.now();
const MAP_ID = 'map-home';

export interface MockDb {
  me: MeDto | null;
  accounts: AdminAccountDto[];
  maps: (MapDto & { role: Exclude<MapRole, 'blocked'> })[];
  systems: MapSystemDto[];
  connections: ConnectionDto[];
  signatures: SignatureDto[];
  characters: CharacterPresenceDto[];
  rules: AccessRuleDto[];
  plugins: PluginDto[];
}

const labels: LabelDto[] = [
  {
    id: 'lbl-static',
    name: 'static',
    color: '#5b93f0',
    description: 'Permanent connection of the home system',
  },
  { id: 'lbl-farm', name: 'farm', color: '#4cb36b', description: 'Sites worth running' },
];

const system = (id: number, x: number, y: number, extra: Partial<MapSystemDto> = {}): MapSystemDto => ({
  mapId: MAP_ID,
  solarSystemId: id,
  position: { x, y },
  customName: null,
  temporaryName: null,
  tag: null,
  status: 'unknown',
  description: '',
  labelIds: [],
  locked: false,
  visible: true,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

const connection = (
  id: string,
  source: number,
  target: number,
  extra: Partial<ConnectionDto> = {},
): ConnectionDto => ({
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
  createdAt: now,
  updatedAt: now,
  ...extra,
});

export function createMockDb(): MockDb {
  const account = {
    id: 'acc-1',
    discordId: '100',
    name: 'Pilot',
    avatarUrl: null,
    instanceRole: 'owner' as const,
    mainCharacterId: 90000001,
    createdAt: now,
  };
  return {
    me: {
      account,
      characters: [
        {
          id: 90000001,
          name: 'Sample Scout',
          corporationId: 98000001,
          allianceId: null,
          tokenValid: true,
          linkedAt: now,
        },
        {
          id: 90000002,
          name: 'Sample Hauler',
          corporationId: 98000001,
          allianceId: null,
          tokenValid: true,
          linkedAt: now,
        },
      ],
    },
    accounts: [
      { ...account, lastSeenAt: now },
      {
        id: 'acc-2',
        discordId: '200',
        name: 'Wingmate',
        avatarUrl: null,
        instanceRole: 'user',
        createdAt: now,
        lastSeenAt: now - 3_600_000,
      },
    ],
    maps: [
      {
        id: MAP_ID,
        slug: 'home',
        name: 'Home chain',
        ownerAccountId: account.id,
        settings: { scopes: ['wormhole'] },
        labels,
        createdAt: now,
        updatedAt: now,
        role: 'admin',
      },
    ],
    systems: [
      system(31090032, 0, 0, {
        status: 'home',
        tag: 'H',
        customName: 'Home',
        labelIds: ['lbl-static'],
        locked: true,
        description: 'Our hole.',
      }),
      system(31090051, 260, -110, { status: 'empty', tag: 'A', labelIds: ['lbl-farm'] }),
      system(30090001, 260, 110, { status: 'occupied', tag: 'B' }),
      system(30000142, 520, 160, { status: 'friendly' }),
      system(31000005, 520, -150, { status: 'warning' }),
      system(31090021, 260, 300, { status: 'hostile', tag: 'C', visible: false }),
    ],
    connections: [
      connection('c1', 31090032, 31090051, { massStatus: 'reduced' }),
      connection('c2', 31090032, 30090001, {
        timeStatus: 'eol',
        eolAt: now - 75 * 60_000,
        shipSize: 'medium',
      }),
      connection('c3', 30090001, 30000142, { type: 'gate', shipSize: 'xlarge' }),
      connection('c4', 31090051, 31000005, { massStatus: 'critical', dangerous: true, bubbled: 'target' }),
      connection('c5', 31090032, 31090021, { bubbled: 'both', massSaved: true }),
    ],
    signatures: [
      {
        id: 's1',
        mapId: MAP_ID,
        solarSystemId: 31090032,
        eveId: 'ABC-123',
        group: 'wormhole',
        type: 'B274',
        name: null,
        description: '',
        connectionId: 'c2',
        createdAt: now - 3_600_000,
        updatedAt: now,
      },
      {
        id: 's2',
        mapId: MAP_ID,
        solarSystemId: 31090032,
        eveId: 'KLM-404',
        group: 'gas',
        type: null,
        name: 'Sizeable Perimeter Reservoir',
        description: '',
        connectionId: null,
        createdAt: now - 7_200_000,
        updatedAt: now,
      },
    ],
    characters: [
      {
        characterId: 90000001,
        accountId: account.id,
        name: 'Sample Scout',
        solarSystemId: 31090051,
        shipTypeId: null,
        shipName: 'Buzzard',
        online: true,
        updatedAt: now,
      },
      {
        characterId: 90000003,
        accountId: 'acc-2',
        name: 'Wing Pilot',
        solarSystemId: 31090032,
        shipTypeId: null,
        shipName: 'Gila',
        online: true,
        updatedAt: now,
      },
    ],
    rules: [
      {
        id: 'r1',
        mapId: MAP_ID,
        subjectKind: 'corporation',
        subjectId: '98000001',
        guildId: null,
        role: 'member',
        createdAt: now,
      },
    ],
    plugins: [
      { id: 'kill-feed', name: 'Kill feed', version: '0.1.0', enabled: true, error: null, hasWeb: false },
    ],
  };
}
