import type { Actor } from '@darkbeacon/core';
import type {
  CommentUseCases,
  ConnectionUseCases,
  MapUseCases,
  PassageUseCases,
  SignatureUseCases,
  StructureUseCases,
  SystemUseCases,
} from '@darkbeacon/mapping';
import type {
  AddSignatureRequest,
  LogPassagesRequest,
  UpdateConnectionRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';

/** Systems of the demo chain (real SDE ids). Wormhole types and statics follow the game data. */
const HOME = 31002531; // J014348, C3 Red Giant, statics D845 (high-sec) and U210 (low-sec)
const MAGNETAR = 31000399; // J130256, C2 Magnetar, statics B274 (high-sec) and O477 (C3)
const PULSAR = 31001924; // J130026, C5 Pulsar, static D364 (C2)
const BLACK_HOLE = 31000220; // J121158, C1 Black Hole, static N110 (high-sec)
const NOURVUKAIKEN = 30001376; // high-sec, Lonetrek
const TAMA = 30002813; // low-sec, The Citadel, one gate from Nourvukaiken
const AMAMAKE = 30002537; // low-sec, Heimatar
const EC_P8R = 30001984; // null-sec, Pure Blind

export const DEMO_MAP_NAME = 'Demo chain';

export interface DemoMapping {
  maps: MapUseCases;
  systems: SystemUseCases;
  connections: ConnectionUseCases;
  signatures: SignatureUseCases;
  /** Comments and structures of the home system; left out when absent. */
  comments?: CommentUseCases;
  structures?: StructureUseCases;
  /** Jumps logged by hand on the demo chain; absent: none (the corp maps). */
  passages?: PassageUseCases;
}

const MEGATHRON = 641;
const ORCA = 28606;
const MINUTE = 60_000;

type SystemSeed = { id: number; x: number; y: number } & UpdateSystemRequest;
type ConnectionSeed = { key: string; source: number; target: number; gate?: true } & UpdateConnectionRequest;
type SignatureSeed = { system: number; connection?: string } & AddSignatureRequest;

/**
 * Seeds "Demo chain" as `actor`: a home C3 with both statics open, a few systems in wormhole and
 * known space, and connections in every state the map can show (EOL, reduced and critical mass,
 * frigate-only, dangerous, bubbled, a stargate), plus the map's default Tags (Home, Sites, Hostile,
 * Exit), Labels on the three holes out of home (WH1 to WH3, the map's default Labels), a custom
 * label and signatures. Goes through the
 * mapping use cases, so it is authorized and evented like any user's edits.
 */
export async function seedDemoChain(actor: Actor, mapping: DemoMapping): Promise<string> {
  const map = await mapping.maps.create(actor, { name: DEMO_MAP_NAME });

  // The map's default Tags (Home, Sites, Hostile, Exit...), looked up by name so a changed
  // default still seeds and the demo never adds a second Staging.
  const tag = (name: string) => map.labels.filter((l) => l.name === name).map((l) => l.id);
  // The map's default Labels; ids are looked up so a changed default still seeds.
  const wh = (name: string) => map.systemLabels.filter((l) => l.name === name).map((l) => l.id);

  const systems: SystemSeed[] = [
    {
      id: HOME,
      x: 676,
      y: 240,
      status: 'home',
      labelIds: tag('Home'),
      locked: true,
      description: 'Home hole: citadel, fleet hangar and the POCOs. Both statics rolled at downtime.',
    },
    {
      id: MAGNETAR,
      x: 312,
      y: 240,
      status: 'empty',
      labelIds: tag('Sites'),
      systemLabelIds: wh('WH3'),
      description: 'Two unrun relic sites, nobody home.',
    },
    {
      id: PULSAR,
      x: -52,
      y: 60,
      status: 'hostile',
      labelIds: tag('Hostile'),
      temporaryName: 'Pulsar C5',
      description: 'Capital-capable group lives here; Rattlesnakes on d-scan.',
    },
    { id: EC_P8R, x: -52, y: 450, status: 'warning', description: 'Gate camp on the Pure Blind side.' },
    {
      id: NOURVUKAIKEN,
      x: 1066,
      y: 90,
      labelIds: tag('Exit'),
      systemLabelIds: wh('WH1'),
      customLabel: 'bait',
      description: 'High-sec exit for hauling.',
    },
    { id: TAMA, x: 1430, y: 90, description: 'Faction warfare camp at the gate.' },
    { id: AMAMAKE, x: 1066, y: 420, labelIds: tag('Exit'), systemLabelIds: wh('WH2') },
    {
      id: BLACK_HOLE,
      x: 1430,
      y: 300,
      status: 'empty',
      description: 'Quiet C1, a short cut to high-sec.',
    },
  ];
  for (const { id, x, y, ...attributes } of systems) {
    await mapping.systems.add(actor, map.id, { solarSystemId: id, position: { x, y } });
    await mapping.systems.update(actor, map.id, id, attributes);
  }

  const connections: ConnectionSeed[] = [
    { key: 'd845', source: HOME, target: NOURVUKAIKEN },
    { key: 'u210', source: HOME, target: AMAMAKE, massStatus: 'reduced' },
    { key: 'gate', source: NOURVUKAIKEN, target: TAMA, gate: true },
    { key: 'o477', source: MAGNETAR, target: HOME, timeStatus: 'eol' },
    { key: 'd364', source: PULSAR, target: MAGNETAR, massStatus: 'critical', dangerous: true },
    { key: 'q003', source: MAGNETAR, target: EC_P8R, shipSize: 'small', bubbled: 'target' },
    { key: 'n110', source: BLACK_HOLE, target: NOURVUKAIKEN, massSaved: true },
  ];
  const ids = new Map<string, string>();
  for (const { key, source, target, gate, ...state } of connections) {
    const added = await mapping.connections.add(actor, map.id, {
      source,
      target,
      ...(gate ? { type: 'gate' as const } : {}),
    });
    ids.set(key, added.id);
    if (Object.keys(state).length > 0) await mapping.connections.update(actor, map.id, added.id, state);
  }

  const signatures: SignatureSeed[] = [
    { system: HOME, eveId: 'DKR-845', type: 'D845', connection: 'd845', description: 'Static to high-sec.' },
    { system: HOME, eveId: 'ULX-210', type: 'U210', connection: 'u210', description: 'Static to low-sec.' },
    { system: HOME, eveId: 'KAE-162', type: 'K162', connection: 'o477', description: 'From the C2.' },
    { system: HOME, eveId: 'GHZ-417', group: 'gas', name: 'Vast Frontier Reservoir' },
    { system: HOME, eveId: 'RLK-302', group: 'relic', name: 'Forgotten Frontier Quarantine Outpost' },
    { system: HOME, eveId: 'DTA-559', group: 'data', name: 'Unsecured Frontier Database' },
    { system: HOME, eveId: 'QNV-904' },
    // Probed to the group only (25 % to 75 %): the name is not in yet.
    { system: HOME, eveId: 'GSX-118', group: 'gas' },
    // Combat and ore sites in w-space are anomalies: on the scanner at once, no probes.
    { system: HOME, eveId: 'FCS-731', kind: 'anomaly', group: 'combat', name: 'Frontier Barracks' },
    { system: HOME, eveId: 'ODP-206', kind: 'anomaly', group: 'ore', name: 'Ordinary Perimeter Deposit' },
    {
      system: HOME,
      eveId: 'WND-552',
      group: 'wormhole',
      type: 'E004',
      tempName: 'Frig C1',
      bubbled: true,
      description: 'Bubbled on our side. Not linked yet.',
    },
    { system: MAGNETAR, eveId: 'OBW-477', type: 'O477', connection: 'o477' },
    {
      system: MAGNETAR,
      eveId: 'KCC-162',
      type: 'K162',
      destination: 'c5',
      connection: 'd364',
      description: 'Hostile C5.',
    },
    { system: MAGNETAR, eveId: 'QFR-003', type: 'Q003', connection: 'q003', description: 'Frigates only.' },
    { system: MAGNETAR, eveId: 'BHS-274', type: 'B274', description: 'Not opened yet.' },
  ];
  for (const { system, connection, ...request } of signatures) {
    const added = await mapping.signatures.add(actor, map.id, system, request);
    const connectionId = connection ? ids.get(connection) : undefined;
    if (connectionId) await mapping.signatures.update(actor, map.id, added.id, { connectionId });
  }

  await mapping.comments?.add(actor, map.id, PULSAR, {
    text: 'Rattlesnakes and a **Nestor** on d-scan at 19:40. Their Fortizar is in reinforce, see Structures.',
  });
  await mapping.comments?.add(actor, map.id, HOME, {
    text: 'Rolling the D845 after downtime. Ping in [fleet comms](https://example.com) before jumping.',
  });
  if (mapping.structures) {
    await mapping.structures.paste(
      actor,
      map.id,
      PULSAR,
      [
        '35833\tJ130026 - Hammer Time\tFortizar\t3,210 km',
        '35835\tJ130026 - Moon Drill\tAthanor\t1.2 AU',
      ].join('\n'),
    );
    const until = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const stamp = `${until.getUTCFullYear()}.${String(until.getUTCMonth() + 1).padStart(2, '0')}.${String(until.getUTCDate()).padStart(2, '0')} ${String(until.getUTCHours()).padStart(2, '0')}:${String(until.getUTCMinutes()).padStart(2, '0')}`;
    await mapping.structures.paste(actor, map.id, PULSAR, `Hammer Time\n3,210 km\nReinforced until ${stamp}`);
    await mapping.structures.add(actor, map.id, HOME, {
      typeId: 35832,
      typeName: 'Astrahus',
      name: 'Home Sweet Home',
      owner: { id: 98000001, name: 'Darkbeacon Demo Corp', ticker: 'DBK' },
    });
  }
  // A rolling crew at work: a Megathron hot and an Orca cold through the high-sec static, and on
  // the low-sec static two jumps from before it was marked reduced (kept, no longer counted).
  if (mapping.passages) {
    const now = Date.now();
    const log = (key: string, request: LogPassagesRequest, minutesAgo: number) =>
      mapping.passages!.log(actor, map.id, ids.get(key)!, {
        ...request,
        occurredAt: now - minutesAgo * MINUTE,
      });
    await log('u210', { shipTypeId: MEGATHRON, direction: 'sourceToTarget', massMode: 'hot' }, 95);
    await log('u210', { shipTypeId: MEGATHRON, direction: 'targetToSource', massMode: 'cold' }, 92);
    await log(
      'd845',
      { shipTypeId: MEGATHRON, direction: 'sourceToTarget', massMode: 'cold', note: 'Roller 1' },
      18,
    );
    await log(
      'd845',
      { shipTypeId: MEGATHRON, direction: 'targetToSource', massMode: 'hot', note: 'Roller 1' },
      16,
    );
    await log('d845', { shipTypeId: ORCA, direction: 'sourceToTarget', massMode: 'cold' }, 9);
    await log('d845', { shipTypeId: ORCA, direction: 'targetToSource', massMode: 'hot', higgs: true }, 7);
  }
  return map.id;
}
