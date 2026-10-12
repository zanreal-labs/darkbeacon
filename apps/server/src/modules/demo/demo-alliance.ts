import type { Actor } from '@darkbeacon/core';
import type { SharingUseCases } from '@darkbeacon/sharing';
import type { DemoMapping } from './demo-chain.js';

// The same real systems as the demo chain (see demo-chain.ts).
const MAGNETAR = 31000399; // J130256, C2
const PULSAR = 31001924; // J130026, C5
const BLACK_HOLE = 31000220; // J121158, C1
const NOURVUKAIKEN = 30001376; // high-sec
const EC_P8R = 30001984; // null-sec

export const DEMO_ALLIANCE_NAME = 'Alliance chain';

/**
 * Seeds two corporation maps that each mapped part of the same chain, and an "Alliance chain"
 * composite merging both: they overlap on the C2 and the C5 and disagree about the mass of the hole
 * between them (Corp B looked later and saw it critical). Corp A is shared read-write with its
 * intel, Corp B read-only with the default scopes.
 */
export async function seedDemoAlliance(
  actor: Actor,
  mapping: DemoMapping,
  sharing: SharingUseCases,
): Promise<string> {
  const corpA = await mapping.maps.create(actor, { name: 'Corp A chain' });
  const corpB = await mapping.maps.create(actor, { name: 'Corp B chain' });
  const alliance = await mapping.maps.create(actor, { name: DEMO_ALLIANCE_NAME, kind: 'composite' });

  const place = async (mapId: string, solarSystemId: number, x: number, y: number) =>
    mapping.systems.add(actor, mapId, { solarSystemId, position: { x, y } });

  // Corp A: the C2 with its way into the C5 and a null-sec exit.
  await place(corpA.id, MAGNETAR, 0, 150);
  await place(corpA.id, PULSAR, 360, 0);
  await place(corpA.id, EC_P8R, 360, 300);
  await mapping.systems.update(actor, corpA.id, PULSAR, {
    status: 'hostile',
    description: 'Capital-capable group; Rattlesnakes on d-scan.',
  });
  await mapping.systems.update(actor, corpA.id, MAGNETAR, { status: 'friendly', tag: 'A' });
  const aHole = await mapping.connections.add(actor, corpA.id, { source: MAGNETAR, target: PULSAR });
  await mapping.connections.update(actor, corpA.id, aHole.id, { massStatus: 'reduced' });
  const aExit = await mapping.connections.add(actor, corpA.id, { source: MAGNETAR, target: EC_P8R });
  await mapping.connections.update(actor, corpA.id, aExit.id, { shipSize: 'medium' });
  const aSig = await mapping.signatures.add(actor, corpA.id, MAGNETAR, { eveId: 'KCC-162', type: 'K162' });
  await mapping.signatures.update(actor, corpA.id, aSig.id, { connectionId: aHole.id });

  // Corp B: the C5 onwards to a C1 and high-sec; it saw the C2 - C5 hole later, critical.
  await place(corpB.id, PULSAR, 0, 0);
  await place(corpB.id, MAGNETAR, -360, 0);
  await place(corpB.id, BLACK_HOLE, 360, 0);
  await place(corpB.id, NOURVUKAIKEN, 720, 0);
  const bHole = await mapping.connections.add(actor, corpB.id, { source: PULSAR, target: MAGNETAR });
  const bSig = await mapping.signatures.add(actor, corpB.id, PULSAR, {
    eveId: 'DKR-364',
    type: 'D364',
    description: 'Static into the C2.',
  });
  await mapping.signatures.update(actor, corpB.id, bSig.id, { connectionId: bHole.id });
  const bNext = await mapping.connections.add(actor, corpB.id, { source: PULSAR, target: BLACK_HOLE });
  await mapping.connections.update(actor, corpB.id, bNext.id, { timeStatus: 'eol' });
  await mapping.connections.add(actor, corpB.id, { source: BLACK_HOLE, target: NOURVUKAIKEN });
  await mapping.connections.update(actor, corpB.id, bHole.id, { massStatus: 'critical' });

  await sharing.offer(actor, corpA.id, {
    targetMapId: alliance.id,
    level: 'read-write',
    scopes: ['topology', 'connectionStatus', 'signatures', 'intel'],
  });
  await sharing.offer(actor, corpB.id, { targetMapId: alliance.id, level: 'read' });
  return alliance.id;
}
