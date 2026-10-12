import { newId, type Actor } from '@darkbeacon/core';
import type { ConnectionUseCases, MapUseCases, SignatureUseCases, SystemUseCases } from '@darkbeacon/mapping';
import type {
  AddSignatureRequest,
  LabelDto,
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
}

type SystemSeed = { id: number; x: number; y: number } & UpdateSystemRequest;
type ConnectionSeed = { key: string; source: number; target: number; gate?: true } & UpdateConnectionRequest;
type SignatureSeed = { system: number; connection?: string } & AddSignatureRequest;

/**
 * Seeds "Demo chain" as `actor`: a home C3 with both statics open, a few systems in wormhole and
 * known space, and connections in every state the map can show (EOL, reduced and critical mass,
 * frigate-only, dangerous, bubbled, a stargate), plus Tags, Labels on the three holes out of home
 * (WH1 to WH3, the map's default Labels), a custom label and signatures. Goes through the
 * mapping use cases, so it is authorized and evented like any user's edits.
 */
export async function seedDemoChain(actor: Actor, mapping: DemoMapping): Promise<string> {
  const map = await mapping.maps.create(actor, { name: DEMO_MAP_NAME });

  const label = (name: string, color: string, description: string): LabelDto => ({
    id: newId(),
    name,
    color,
    description,
  });
  const staging = label('Staging', '#38c6d6', 'Our home hole: citadel, fleet hangar and the POCOs.');
  const ratting = label('Sites', '#3fbf7f', 'Combat, relic or gas sites worth running this cycle.');
  const hostile = label('Hostile', '#f05252', 'Hostiles seen in the last hour. Scout before you jump.');
  const exit = label('Exit', '#eba23b', 'Known-space exit for logistics runs.');
  await mapping.maps.setLabels(actor, map.id, [staging, ratting, hostile, exit]);
  // The map's default Labels; ids are looked up so a changed default still seeds.
  const wh = (name: string) => map.systemLabels.filter((l) => l.name === name).map((l) => l.id);

  const systems: SystemSeed[] = [
    {
      id: HOME,
      x: 676,
      y: 240,
      status: 'home',
      labelIds: [staging.id],
      locked: true,
      description: 'Home hole: citadel, fleet hangar and the POCOs. Both statics rolled at downtime.',
    },
    {
      id: MAGNETAR,
      x: 312,
      y: 240,
      status: 'empty',
      labelIds: [ratting.id],
      systemLabelIds: wh('WH3'),
      description: 'Two unrun relic sites, nobody home.',
    },
    {
      id: PULSAR,
      x: -52,
      y: 60,
      status: 'hostile',
      labelIds: [hostile.id],
      temporaryName: 'Pulsar C5',
      description: 'Capital-capable group lives here; Rattlesnakes on d-scan.',
    },
    { id: EC_P8R, x: -52, y: 450, status: 'warning', description: 'Gate camp on the Pure Blind side.' },
    {
      id: NOURVUKAIKEN,
      x: 1066,
      y: 90,
      labelIds: [exit.id],
      systemLabelIds: wh('WH1'),
      customLabel: 'bait',
      description: 'High-sec exit for hauling.',
    },
    { id: TAMA, x: 1430, y: 90, description: 'Faction warfare camp at the gate.' },
    { id: AMAMAKE, x: 1066, y: 420, labelIds: [exit.id], systemLabelIds: wh('WH2') },
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
    { system: MAGNETAR, eveId: 'OBW-477', type: 'O477', connection: 'o477' },
    { system: MAGNETAR, eveId: 'KCC-162', type: 'K162', connection: 'd364', description: 'Hostile C5.' },
    { system: MAGNETAR, eveId: 'QFR-003', type: 'Q003', connection: 'q003', description: 'Frigates only.' },
    { system: MAGNETAR, eveId: 'BHS-274', type: 'B274', description: 'Not opened yet.' },
  ];
  for (const { system, connection, ...request } of signatures) {
    const added = await mapping.signatures.add(actor, map.id, system, request);
    const connectionId = connection ? ids.get(connection) : undefined;
    if (connectionId) await mapping.signatures.update(actor, map.id, added.id, { connectionId });
  }
  return map.id;
}
