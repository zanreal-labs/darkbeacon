import { describe, expect, it } from 'vitest';
import { wormholeTypesIn } from '@darkbeacon/shared';
import { parseSignaturePaste } from './signature-paste.js';
import { parseStructurePaste, structureName } from './structure-paste.js';

describe('probe scanner paste in other client languages', () => {
  it.each([
    ['ru', 'Скрытый сигнал', 'Червоточина', 'Газовый район', 'Космическая аномалия'],
    ['fr', 'Signature cosmique (type)', 'Trou de ver', 'Site de collecte de gaz', 'Anomalie cosmique'],
    [
      'fr without qualifier',
      'Signature cosmique',
      'Trou de ver',
      'Site de collecte de gaz',
      'Anomalie cosmique',
    ],
    ['de', 'Kosmische Signatur (typ)', 'Wurmloch', 'Gasgebiet', 'Kosmische Anomalie'],
  ])('%s', (_, scanGroup, wormhole, gas, anomaly) => {
    const text = [
      `ABC-123\t${scanGroup}\t${wormhole}\t\t100,0%\t4,32 AU`,
      `DEF-456\t${scanGroup}\t${gas}\tSomething Reservoir\t100,0%\t1 AU`,
      `GHI-789\t${scanGroup}\t\t\t0,0%\t12 AU`,
      `JKL-012\t${anomaly}\tCombat\tBlood Hideaway\t100,0%\t2 AU`,
    ].join('\n');
    expect(parseSignaturePaste(text)).toEqual({
      signatures: [
        { eveId: 'ABC-123', kind: 'signature', group: 'wormhole', name: null, type: null },
        { eveId: 'DEF-456', kind: 'signature', group: 'gas', name: 'Something Reservoir', type: null },
        { eveId: 'GHI-789', kind: 'signature', group: 'unknown', name: null, type: null },
        // Anomalies are kept as anomalies; their group column is in the client's language too.
        { eveId: 'JKL-012', kind: 'anomaly', group: 'unknown', name: 'Blood Hideaway', type: null },
      ],
      skipped: [],
    });
  });
});

describe('structure paste', () => {
  it('reads d-scan rows of Upwell structures and drops the system name', () => {
    expect(
      parseStructurePaste(
        '35833\tJ214811 - Folgers\tFortizar\t1,475 km\n35826\tFactory\tAzbel*\t2 AU\nnoise',
      ),
    ).toEqual({
      kind: 'structures',
      structures: [
        { typeId: 35833, typeName: 'Fortizar', name: 'Folgers' },
        { typeId: 35826, typeName: 'Azbel', name: 'Factory' },
      ],
      skipped: ['noise'],
    });
    expect(structureName('J214811 - Folgers')).toBe('Folgers');
  });

  it('reads a timer in EVE time', () => {
    expect(parseStructurePaste('J214811 - Folgers\n1,475 km\nAnchoring until 2025.01.13 23:51')).toEqual({
      kind: 'timer',
      timer: { name: 'Folgers', status: 'anchoring', endsAt: Date.UTC(2025, 0, 13, 23, 51) },
    });
    expect(parseStructurePaste('Folgers\n1 km\nShield until 2025.01.13 05:00')).toMatchObject({
      timer: { status: 'reinforced' },
    });
  });
});

describe('wormhole types of a system', () => {
  it('lists its statics, K162 and the wanderers of its class', () => {
    const c3 = wormholeTypesIn(3, ['D845', 'U210']);
    expect(c3.statics).toEqual(['D845', 'U210', 'K162']);
    expect(c3.wandering).toContain('E004');
    expect(c3.wandering).not.toContain('D845');
    // Statics unknown: every static type of the class.
    expect(wormholeTypesIn(2, []).statics).toEqual(expect.arrayContaining(['A239', 'K162']));
  });
});
