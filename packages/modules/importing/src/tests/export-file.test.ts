import { describe, expect, it } from 'vitest';
import {
  exportFileV2,
  settingsExport,
  SYS,
  systemName,
  systemsAnswer,
  connectionsAnswer,
} from '../test-support.js';
import { exportFormat, readExportFile } from '../domain/export-file.js';
import { parseWandererBase, parseWandererSlug } from '../domain/source-url.js';
import { translate } from '../domain/translate.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');

describe('Wanderer export files', () => {
  it('reads the map contents export with signatures and comments', () => {
    const dump = readExportFile(exportFileV2(), 'exported.json', NOW);
    expect(dump.source).toEqual({
      kind: 'wanderer-file',
      host: 'file',
      slug: 'exported',
      name: 'Exported Chain',
    });
    expect(dump.readAt).toBe(Date.parse('2026-10-12T09:00:00Z'));
    expect(dump.systems.map((s) => s.solarSystemId)).toEqual([SYS.home, SYS.c2]);
    expect(dump.labelNames).toEqual({ x1: 'Exit' });
    const { plan, report } = translate(dump, { systemName });
    expect(plan.signatures[0]).toMatchObject({
      eveId: 'ZZZ-999',
      linkedTo: SYS.c2,
      fields: { type: 'O477' },
    });
    expect(plan.systems.find((s) => s.solarSystemId === SYS.c2)?.fields.description).toContain('- Empty C2');
    expect(plan.labels.map((l) => l.name)).toEqual(['Exit']);
    // Rows without times count as changed when the file was exported.
    expect(plan.systems[0]!.remoteUpdatedAt).toBe(dump.readAt);
    expect(report.some((l) => /Access lists are not part of Wanderer export files/.test(l.what))).toBe(true);
  });

  it('reads the settings page export and the API backup', () => {
    const settings = readExportFile(settingsExport(), 'chain.json', NOW);
    expect(exportFormat(settingsExport())).toBe('map-settings');
    expect(settings.systems).toHaveLength(2);
    expect(settings.connections[0]).toMatchObject({ source: SYS.home, target: SYS.hs, massStatus: 1 });
    expect(settings.hubs).toEqual([SYS.jita]);
    expect(settings.source.slug).toBe('chain');

    const backup = { data: { systems: systemsAnswer().data, connections: connectionsAnswer().data } };
    expect(exportFormat(backup)).toBe('api-backup');
    expect(readExportFile(backup, null, NOW).connections).toHaveLength(6);
  });

  it('refuses what is not a Wanderer export, with a reason', () => {
    expect(() => readExportFile([], null, NOW)).toThrow(/not a Wanderer export/);
    expect(() => readExportFile({ maps: [] }, null, NOW)).toThrow(/has no systems/);
    expect(() => readExportFile({ ...exportFileV2(), version: 9 }, null, NOW)).toThrow(/version 9/);
  });
});

describe('Wanderer addresses', () => {
  it('normalises the instance address and refuses unsafe ones', () => {
    expect(parseWandererBase('wanderer.ltd', { allowPlainHttp: false })).toMatchObject({
      url: 'https://wanderer.ltd',
      host: 'wanderer.ltd',
    });
    expect(
      parseWandererBase('https://map.example.org:8443/home-chain', { allowPlainHttp: false }),
    ).toMatchObject({
      url: 'https://map.example.org:8443',
      host: 'map.example.org:8443',
      hostname: 'map.example.org',
    });
    expect(() => parseWandererBase('http://wanderer.lan', { allowPlainHttp: false })).toThrow(/https/);
    expect(parseWandererBase('http://10.0.0.5:4000', { allowPlainHttp: true }).url).toBe(
      'http://10.0.0.5:4000',
    );
    expect(() => parseWandererBase('https://user:pw@wanderer.ltd', { allowPlainHttp: false })).toThrow(
      /password/,
    );
    expect(() => parseWandererBase('ftp://wanderer.ltd', { allowPlainHttp: true })).toThrow(/https/);
    expect(() => parseWandererBase('https://wanderer.ltd/?x=1', { allowPlainHttp: true })).toThrow(
      /without \?/,
    );
  });

  it('takes the slug from a pasted map address', () => {
    expect(parseWandererSlug('home-chain')).toBe('home-chain');
    expect(parseWandererSlug('https://wanderer.ltd/home-chain')).toBe('home-chain');
    expect(() => parseWandererSlug('../etc')).toThrow(/slug/);
  });
});
