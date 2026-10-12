import { describe, expect, it } from 'vitest';
import { defaultShipSize, nextPosition, slugify, validateLabels } from './rules.js';
import { parseSignaturePaste, type ScannerLanguage } from './signature-paste.js';

const universe = (whClass: number | null) => ({
  id: 1,
  name: 'x',
  regionName: '',
  constellationName: '',
  security: -1,
  whClass,
  statics: [],
  effect: null,
});

describe('signature paste', () => {
  const paste = [
    'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.32 AU',
    'DEF-456\tCosmic Signature\tGas Site\tBarren Perimeter Reservoir\t100.0%\t12.10 AU',
    'GHI-789\tCosmic Signature\t\t\t0.0%\t8,51 AU',
    'JKL-012\tCosmic Anomaly\tCombat Site\tSansha Forsaken Hub\t100.0%\t2.00 AU',
    '',
    'not a scanner line',
    'mno-345\tCosmic Signature\tData Site\tUnsecured Frontier Server Bank\t42.1%\t1 AU',
  ].join('\r\n');

  it('reads cosmic signatures and normalizes ids', () => {
    const { signatures, skipped } = parseSignaturePaste(paste);
    expect(signatures).toEqual([
      { eveId: 'ABC-123', group: 'wormhole', name: null },
      { eveId: 'DEF-456', group: 'gas', name: 'Barren Perimeter Reservoir' },
      { eveId: 'GHI-789', group: 'unknown', name: null },
      { eveId: 'MNO-345', group: 'data', name: 'Unsecured Frontier Server Bank' },
    ]);
    // Anomalies are understood and dropped; garbage is reported.
    expect(skipped).toEqual(['not a scanner line']);
  });

  it('keeps the last line for a repeated id', () => {
    const { signatures } = parseSignaturePaste(
      'ABC-123\tCosmic Signature\t\t\t0.0%\t1 AU\nABC-123\tCosmic Signature\tRelic Site\tRuins\t100%\t1 AU',
    );
    expect(signatures).toEqual([{ eveId: 'ABC-123', group: 'relic', name: 'Ruins' }]);
  });

  it('takes more languages from the table', () => {
    const pirate: ScannerLanguage = {
      code: 'xx',
      cosmicSignature: 'Booty',
      ignoredScanGroups: [],
      groups: { Hole: 'wormhole' },
      genericNames: [],
    };
    const { signatures } = parseSignaturePaste('ABC-123\tBooty\tHole\tB274\t1%\t1 AU', [pirate]);
    expect(signatures).toEqual([{ eveId: 'ABC-123', group: 'wormhole', name: 'B274' }]);
  });
});

describe('rules', () => {
  it('slugifies names', () => {
    expect(slugify('Home Chain #2')).toBe('home-chain-2');
    expect(slugify('Ünïcode  --  Map')).toBe('unicode-map');
    expect(slugify('!')).toBe('map');
  });

  it('picks a default ship size', () => {
    expect(defaultShipSize('gate', null, null)).toBe('xlarge');
    expect(defaultShipSize('wormhole', universe(5), universe(2))).toBe('large');
    expect(defaultShipSize('wormhole', universe(7), universe(1))).toBe('medium');
    expect(defaultShipSize('wormhole', universe(1), universe(13))).toBe('small');
  });

  it('places new systems to the right', () => {
    expect(nextPosition([])).toEqual({ x: 0, y: 0 });
    expect(
      nextPosition([
        { x: 10, y: 5 },
        { x: 300, y: 40 },
      ]),
    ).toEqual({ x: 520, y: 40 });
  });

  it('rejects duplicate labels', () => {
    const label = { id: 'a', name: 'Home', color: '#ffffff', description: '' };
    expect(() => validateLabels([label, { ...label, id: 'b', name: 'home' }])).toThrow(/name/);
    expect(() => validateLabels([label, { ...label, name: 'Other' }])).toThrow(/id/);
    expect(() => validateLabels([label])).not.toThrow();
  });
});
