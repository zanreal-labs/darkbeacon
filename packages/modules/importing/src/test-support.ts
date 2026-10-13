// Fixtures for import tests: answers shaped like Wanderer's documented API (field names and value
// codes from its API guides), with data made up for these tests.
import {
  emptyDump,
  readAclMember,
  readAll,
  readComment,
  readPassage,
  readConnection,
  readSignature,
  readStructure,
  readSystem,
  type WandererMapDump,
} from './domain/wanderer.js';

/** Real solar system ids (the SDE), so the same fixtures work against the universe catalog. */
export const SYS = {
  home: 31002531, // J014348, C3
  c2: 31000399, // J130256
  c5: 31001924, // J130026
  c1: 31000220, // J121158
  hs: 30001376, // Nourvukaiken
  jita: 30000142,
  perimeter: 30000144,
} as const;

export const NAMES: Record<number, string> = {
  [SYS.home]: 'J014348',
  [SYS.c2]: 'J130256',
  [SYS.c5]: 'J130026',
  [SYS.c1]: 'J121158',
  [SYS.hs]: 'Nourvukaiken',
  [SYS.jita]: 'Jita',
  [SYS.perimeter]: 'Perimeter',
};

export const systemName = (id: number): string | null => NAMES[id] ?? null;

const MAP_UUID = '7a6b5c4d-1111-4222-8333-944455556666';
const T0 = '2026-10-10T12:00:00.000000Z';
const T1 = '2026-10-12T08:30:15.123456Z';

/**
 * Systems as the REST API lists them (`name` shown, `custom_name` resolved), hidden ones included
 * as the export gives them. Statuses in Wanderer's stored numbering (1 home, 2 friendly, 3 looking
 * for, 4 warning, 5 target, 6 dangerous).
 */
export function systemsAnswer() {
  return {
    data: [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        map_id: MAP_UUID,
        solar_system_id: SYS.home,
        name: 'Home sweet home',
        original_name: 'J014348',
        custom_name: 'Home sweet home',
        temporary_name: null,
        description: 'Our home. Rolling on Tuesdays.',
        tag: 'HQ',
        labels: '{"customLabel":"Staging","labels":["a","1"]}',
        status: 1,
        visible: true,
        locked: true,
        position_x: 0,
        position_y: 0,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        map_id: MAP_UUID,
        solar_system_id: String(SYS.c2),
        name: '1a',
        original_name: 'J130256',
        custom_name: null,
        temporary_name: '1a',
        description: null,
        tag: null,
        labels: 'b',
        status: 5,
        visible: true,
        locked: false,
        position_x: 150,
        position_y: 0,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        map_id: MAP_UUID,
        solar_system_id: SYS.c5,
        name: 'J130026',
        custom_name: null,
        temporary_name: null,
        description: 'Hostile residents',
        tag: 'FARMTAGISWAYTOOLONGFORDB',
        labels: '',
        status: 3,
        visible: true,
        locked: false,
        position_x: 150,
        position_y: 60,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000004',
        map_id: MAP_UUID,
        solar_system_id: SYS.c1,
        name: 'J121158',
        custom_name: null,
        temporary_name: null,
        description: 'Hidden, but the notes stay',
        tag: null,
        labels: null,
        status: 0,
        visible: false,
        locked: false,
        position_x: 300,
        position_y: 0,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000005',
        map_id: MAP_UUID,
        solar_system_id: SYS.hs,
        name: 'Nourvukaiken',
        status: 2,
        visible: true,
        locked: false,
        position_x: 0,
        position_y: 70,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000006',
        map_id: MAP_UUID,
        solar_system_id: SYS.jita,
        name: 'Jita',
        status: 0,
        visible: true,
        locked: false,
        position_x: 0,
        position_y: 140,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000007',
        map_id: MAP_UUID,
        solar_system_id: SYS.perimeter,
        name: 'Perimeter',
        status: 0,
        visible: true,
        locked: false,
        position_x: 150,
        position_y: 140,
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000008',
        map_id: MAP_UUID,
        solar_system_id: 99999999,
        name: 'Nowhere',
        status: 0,
        visible: true,
      },
      { nonsense: true },
    ],
  };
}

/** `GET /api/maps/:slug/connections` */
export function connectionsAnswer() {
  const base = { map_id: MAP_UUID, locked: false, count_of_passage: 0, inserted_at: T0, updated_at: T1 };
  return {
    data: [
      {
        ...base,
        id: 'c1',
        solar_system_source: SYS.home,
        solar_system_target: SYS.c2,
        type: 0,
        mass_status: 1,
        time_status: 2,
        ship_size_type: 2,
        wormhole_type: 'O477',
        custom_info: 'Rolled once',
        count_of_passage: 4,
      },
      {
        ...base,
        id: 'c2',
        solar_system_source: SYS.home,
        solar_system_target: SYS.c5,
        type: 0,
        mass_status: 2,
        time_status: 1,
        ship_size_type: 3,
        wormhole_type: 'U210',
        dangerous: true,
        bubbled: 2,
      },
      {
        ...base,
        id: 'c3',
        solar_system_source: SYS.c2,
        solar_system_target: SYS.hs,
        type: 0,
        mass_status: 0,
        time_status: 5,
        ship_size_type: 1,
        wormhole_type: 'K162',
        locked: true,
      },
      {
        ...base,
        id: 'c4',
        solar_system_source: SYS.jita,
        solar_system_target: SYS.perimeter,
        type: 1,
        mass_status: 0,
        time_status: 0,
        ship_size_type: 4,
        wormhole_type: null,
      },
      {
        ...base,
        id: 'c5',
        solar_system_source: SYS.c2,
        solar_system_target: SYS.c1,
        type: 0,
        mass_status: 0,
        time_status: 0,
        ship_size_type: 2,
      },
      { ...base, id: 'c6', solar_system_source: SYS.perimeter, solar_system_target: SYS.jita, type: 1 },
    ],
  };
}

/** `GET /api/maps/:slug/signatures` */
export function signaturesAnswer() {
  const base = { kind: 'Cosmic Signature', character_eve_id: '2112625428', inserted_at: T0, updated_at: T1 };
  return {
    data: [
      {
        ...base,
        id: 's1',
        system_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        solar_system_id: SYS.home,
        eve_id: 'ABC-123',
        group: 'Wormhole',
        type: null,
        name: null,
        linked_system_id: SYS.c2,
        temporary_name: '1a',
        custom_info: '{"time_status":2,"bookmark_index":1}',
      },
      {
        ...base,
        id: 's2',
        system_id: 'aaaaaaaa-0000-4000-8000-000000000002',
        eve_id: 'xyz-789',
        group: 'wormhole',
        type: 'K162',
        linked_system_id: SYS.home,
      },
      {
        ...base,
        id: 's3',
        solar_system_id: SYS.home,
        eve_id: 'DEF-456',
        group: 'Relic Site',
        name: 'Forgotten Perimeter Coronation Platform',
        description: 'Hacked half',
      },
      {
        ...base,
        id: 's4',
        solar_system_id: SYS.c5,
        eve_id: 'GHI-111',
        group: 'Gas Site',
        name: 'Vital Core Reservoir',
      },
      {
        ...base,
        id: 's5',
        solar_system_id: SYS.c5,
        eve_id: 'JKL-222',
        kind: 'Cosmic Anomaly',
        group: 'Combat Site',
        name: 'Core Garrison',
      },
      { ...base, id: 's6', solar_system_id: SYS.c5, eve_id: 'MN-1', group: 'Data Site' },
      {
        ...base,
        id: 's7',
        solar_system_id: SYS.c1,
        eve_id: 'OPQ-333',
        group: 'Ore Site',
        description: 'In the hidden system',
      },
      {
        ...base,
        id: 's8',
        solar_system_id: SYS.c5,
        eve_id: 'RST-444',
        group: 'Wormhole',
        linked_system_id: SYS.jita,
      },
      {
        ...base,
        id: 's9',
        solar_system_id: SYS.c5,
        eve_id: 'STU-555',
        kind: 'Structure',
        group: null,
        name: 'Astrahus',
      },
      {
        ...base,
        id: 's10',
        solar_system_id: SYS.c5,
        eve_id: 'VWX-666',
        group: 'Wormhole',
        custom_info: '{"time_status":4,"destType":"C5"}',
      },
    ],
  };
}

/** `GET /api/maps/:slug/structures` */
export function structuresAnswer() {
  return {
    data: [
      {
        id: 'st1',
        system_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        solar_system_id: SYS.home,
        solar_system_name: 'J014348',
        structure_type_id: '35833',
        structure_type: 'Fortizar',
        character_eve_id: '2112625428',
        name: 'Home Fort',
        notes: 'Fuel until November',
        owner_name: 'Wormhole Rescue Ltd',
        owner_ticker: 'RESQ',
        owner_id: null,
        status: 'online',
        end_time: null,
        inserted_at: T0,
        updated_at: T1,
      },
      {
        id: 'st2',
        system_id: 'aaaaaaaa-0000-4000-8000-000000000003',
        solar_system_id: SYS.c5,
        structure_type: 'Astrahus',
        name: 'Their Astra',
        owner_ticker: 'HKINC',
        status: 'reinforced',
        end_time: '2026-10-12T20:00:00Z',
      },
    ],
  };
}

/** `GET /api/v1/map_system_comments` (JSON:API) */
export function commentsAnswer() {
  return {
    data: [
      {
        id: 'cm1',
        type: 'map_system_comments',
        attributes: {
          text: 'Neut Loki on d-scan',
          inserted_at: '2026-10-11T19:00:00Z',
          character: { name: 'Scout Alt', eve_id: '2116161001' },
        },
        relationships: {
          system: { data: { type: 'map_systems', id: 'aaaaaaaa-0000-4000-8000-000000000001' } },
        },
      },
    ],
  };
}

/** `GET /api/map/acls` and `GET /api/acls/:id` */
export const ACLS = [
  {
    id: 'acl-corp',
    name: 'Corp',
    members: [
      { id: 'm1', name: 'Wormhole Rescue Ltd', role: 'member', eve_corporation_id: '98000001' },
      { id: 'm2', name: 'CCP Bartender', role: 'admin', eve_character_id: '2112625428' },
      { id: 'm3', name: 'Scout Alt', role: 'manager', eve_character_id: '2116161001' },
    ],
  },
  {
    id: 'acl-allies',
    name: 'Allies',
    members: [
      { id: 'm4', name: 'Friendly Alliance', role: 'viewer', eve_alliance_id: '99000001' },
      { id: 'm5', name: 'Scout Alt', role: 'viewer', eve_character_id: '2116161001' },
      { id: 'm6', name: 'Awoxer', role: 'blocked', eve_character_id: '2116161002' },
      { id: 'm7', name: 'Spy Corp', role: 'blocked', eve_corporation_id: '98000002' },
      { id: 'm8', name: 'Weird', role: 'owner', eve_character_id: '2116161009' },
    ],
  },
];

/** A dump as the API source reads it from the answers above. */
export function apiDump(readAt = Date.parse('2026-10-12T09:00:00Z')): WandererMapDump {
  const dump = emptyDump(
    { kind: 'wanderer-api', host: 'wanderer.example.org', slug: 'home-chain', name: 'Home Chain' },
    readAt,
  );
  dump.map = { name: 'Home Chain', slug: 'home-chain', description: 'Our chain', scope: 'wormholes' };
  dump.systems = readAll(systemsAnswer().data, readSystem, 'systems', dump.rejected);
  dump.connections = readAll(connectionsAnswer().data, readConnection, 'connections', dump.rejected);
  dump.signatures = readAll(signaturesAnswer().data, readSignature, 'signatures', dump.rejected);
  dump.structures = readAll(structuresAnswer().data, readStructure, 'structures', dump.rejected);
  dump.comments = readAll(commentsAnswer().data, readComment, 'comments', dump.rejected);
  dump.acls = ACLS.map((acl) => ({
    id: acl.id,
    name: acl.name,
    members: readAll(acl.members, readAclMember, 'access', {}),
    error: null,
  }));
  dump.acls.push({ id: 'acl-officers', name: 'Officers', members: null, error: null });
  dump.passages = readAll(
    [
      {
        id: 'p-1',
        solar_system_source_id: SYS.home,
        solar_system_target_id: SYS.c2,
        character_eve_id: '2112625428',
        ship_type_id: 605,
        inserted_at: '2026-10-12T07:00:00Z',
      },
      { id: 'p-2', solar_system_source_id: SYS.home, solar_system_target_id: SYS.hs },
    ],
    readPassage,
    'passages',
    {},
  );
  dump.hubs = [SYS.jita];
  dump.trackedCharacters = 3;
  return dump;
}

/** The map contents export (version 2) of a small chain. */
export function exportFileV2() {
  return {
    version: 2,
    exported_at: '2026-10-12T09:00:00Z',
    map: {
      name: 'Exported Chain',
      slug: 'exported',
      description: null,
      system_labels: [{ id: 'x1', name: 'Exit' }],
    },
    systems: [
      {
        solar_system_id: SYS.home,
        position: { x: 10, y: 20 },
        name: 'J014348',
        custom_name: null,
        description: 'From file',
        labels: '{"customLabel":"","labels":["x1"]}',
        status: 1,
        tag: 'H',
        temporary_name: null,
        locked: false,
        linked_sig_eve_id: null,
        visible: true,
      },
      {
        solar_system_id: SYS.c2,
        position: { x: 200, y: 20 },
        name: 'J130256',
        labels: null,
        status: 0,
        visible: true,
      },
    ],
    connections: [
      {
        source: SYS.home,
        target: SYS.c2,
        type: 0,
        mass_status: 0,
        time_status: 0,
        ship_size_type: 2,
        wormhole_type: 'O477',
        locked: false,
        dangerous: false,
        bubbled: 0,
        custom_info: null,
      },
    ],
    signatures: [
      {
        solar_system_id: SYS.home,
        eve_id: 'ZZZ-999',
        name: null,
        kind: 'Cosmic Signature',
        group: 'Wormhole',
        type: 'O477',
        linked_system_id: SYS.c2,
      },
    ],
    comments: [{ solar_system_id: SYS.c2, text: 'Empty C2' }],
    structures: [],
  };
}

/** The export on Wanderer's map settings page (systems, hubs, connections). */
export function settingsExport() {
  return {
    systems: [
      {
        id: String(SYS.home),
        position: { x: 0, y: 0 },
        description: null,
        name: 'J014348',
        labels: '',
        locked: true,
        status: 1,
        tag: null,
        visible: true,
      },
      {
        id: String(SYS.hs),
        position: { x: 100, y: 0 },
        description: 'exit',
        name: 'Nourvukaiken',
        labels: 'a',
        locked: false,
        status: 2,
        tag: null,
        visible: true,
      },
    ],
    hubs: [String(SYS.jita)],
    connections: [
      {
        id: `${SYS.home}_${SYS.hs}`,
        mass_status: 1,
        time_status: 0,
        ship_size_type: 2,
        locked: false,
        source: String(SYS.home),
        target: String(SYS.hs),
      },
    ],
  };
}
