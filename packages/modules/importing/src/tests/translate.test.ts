import { describe, expect, it } from 'vitest';
import { apiDump, SYS, systemName } from '../test-support.js';
import { translate, type ImportPlan } from '../domain/translate.js';
import { readLabels, readSystem, time } from '../domain/wanderer.js';

const characterName = (eveId: string) => (eveId === '2112625428' ? 'CCP Bartender' : null);
const run = () => translate(apiDump(), { systemName, characterName });
const system = (plan: ImportPlan, id: number) => plan.systems.find((s) => s.solarSystemId === id)!;
const connection = (plan: ImportPlan, a: number, b: number) =>
  plan.connections.find((c) => (c.source === a && c.target === b) || (c.source === b && c.target === a));
const signature = (plan: ImportPlan, eveId: string) => plan.signatures.find((s) => s.eveId === eveId);
const line = (report: ReturnType<typeof run>['report'], bucket: string, what: RegExp) =>
  report.find((l) => l.bucket === bucket && what.test(l.what));

describe('reading Wanderer answers', () => {
  it('reads timestamps with microseconds and without a zone', () => {
    expect(time('2025-01-01T13:38:42.875843Z')).toBe(Date.parse('2025-01-01T13:38:42.875Z'));
    expect(time('2025-01-01T13:38:42')).toBe(Date.parse('2025-01-01T13:38:42Z'));
    expect(time('')).toBeNull();
  });

  it('reads labels as JSON, as a comma list or as a list', () => {
    expect(readLabels('{"customLabel":"Staging","labels":["a","1"]}')).toEqual({
      ids: ['a', '1'],
      custom: 'Staging',
    });
    expect(readLabels('market,hub')).toEqual({ ids: ['market', 'hub'], custom: null });
    expect(readLabels(['a'])).toEqual({ ids: ['a'], custom: null });
    expect(readLabels(null)).toEqual({ ids: [], custom: null });
  });

  it('takes the custom name from the shown name when it differs from the real one', () => {
    const read = readSystem({ solar_system_id: SYS.c5, name: 'Farm', original_name: 'J130026' })!;
    expect(read.customName).toBe('Farm');
    expect(readSystem({ id: String(SYS.c5), position: { x: 1, y: 2 } })).toMatchObject({
      solarSystemId: SYS.c5,
      uuid: null,
      position: { x: 1, y: 2 },
    });
  });
});

describe('translating a Wanderer map', () => {
  it('maps systems with their names, notes, statuses, labels, locks and visibility', () => {
    const { plan, counts } = run();
    expect(counts).toMatchObject({ systems: 6, hiddenSystems: 1, structures: 2, comments: 1 });
    const home = system(plan, SYS.home);
    expect(home.fields).toMatchObject({
      customName: 'Home sweet home',
      status: 'home',
      locked: true,
      visible: true,
      // Wanderer's labels a and 1 are the map's Labels A and 1; its custom label stays one.
      systemLabelIds: ['a', '1'],
      customLabel: 'Staging',
    });
    expect(home.fields).not.toHaveProperty('tag');
    // Without a list of its own a Wanderer map has the labels A, B, C, 1, 2, 3.
    expect(plan.systemLabels.map((l) => `${l.id}:${l.name}`)).toEqual([
      'a:A',
      'b:B',
      'c:C',
      '1:1',
      '2:2',
      '3:3',
    ]);
    expect(home.createdAt).toBe(Date.parse('2026-10-10T12:00:00Z'));
    expect(home.remoteUpdatedAt).toBe(Date.parse('2026-10-12T08:30:15.123Z'));
    // Structures and comments become part of the notes.
    expect(home.fields.description).toContain('Our home. Rolling on Tuesdays.');
    // One titled block per structure and comment, with who and when.
    expect(home.fields.description).toContain(
      [
        'Structure: Fortizar “Home Fort”',
        'Owner: Wormhole Rescue Ltd [RESQ]',
        'Status: online',
        'Notes: Fuel until November',
        'Added by CCP Bartender, 2026-10-10 12:00 UTC (Wanderer)',
      ].join('\n'),
    );
    expect(home.fields.description).toContain(
      'Comment by Scout Alt, 2026-10-11 19:00 UTC (Wanderer)\nNeut Loki on d-scan',
    );
    // Wanderer's tag becomes a Tag of that name (neutral grey).
    const tags = home.fields.labelKeys.map((k) => plan.labels.find((l) => l.key === k)!);
    expect(tags.map((t) => [t.name, t.color])).toEqual([['HQ', '#6b7280']]);

    expect(system(plan, SYS.c2).fields).toMatchObject({ temporaryName: '1a', status: 'target' });
    expect(system(plan, SYS.c1).fields).toMatchObject({
      visible: false,
      description: 'Hidden, but the notes stay',
    });
    // "Looking for" has no status here; it becomes a Tag, next to the system's tag.
    const c5 = system(plan, SYS.c5);
    expect(c5.fields.status).toBe('unknown');
    expect(c5.fields.labelKeys.map((k) => plan.labels.find((l) => l.key === k)!.name)).toEqual([
      'FARMTAGISWAYTOOLONGFORDB',
      'Looking for',
    ]);
  });

  it('takes the map’s own Labels in order: ids kept, names cut, colours dropped, duplicates merged', () => {
    const dump = apiDump();
    dump.systemLabels = [
      { id: 'x1', name: 'Exit', description: 'Way out' },
      { id: 'x2', name: 'VeryLongLabelName', description: null },
      { id: 'x3', name: 'exit', description: 'Again' },
      { id: 'la', name: 'A', description: null },
    ];
    dump.systems[0]!.labels = { ids: ['x3', 'x2', 'gone'], custom: 'a custom label too long' };
    const { plan, report } = translate(dump, { systemName });
    expect(plan.systemLabels).toEqual([
      { id: 'x1', name: 'Exit', description: 'Way out' },
      { id: 'x2', name: 'VeryLong', description: '' },
      { id: 'a', name: 'A', description: '' },
    ]);
    const first = plan.systems.find((s) => s.solarSystemId === dump.systems[0]!.solarSystemId)!;
    expect(first.fields.systemLabelIds).toEqual(['x1', 'x2']);
    expect(first.fields.customLabel).toBe('a custom label t');
    expect(line(report, 'dropped', /Label the map does not list/)).toBeDefined();
    expect(line(report, 'approximated', /Label with the name of another/)?.examples).toEqual(['exit']);
  });

  it('spreads a tight layout to Darkbeacon node sizes', () => {
    const { plan, report } = run();
    expect(plan.layoutScale).toBeGreaterThan(1);
    const home = system(plan, SYS.home).fields.position;
    const c2 = system(plan, SYS.c2).fields.position;
    expect(c2.x - home.x).toBeGreaterThanOrEqual(260);
    expect(line(report, 'approximated', /Positions spread/)).toBeDefined();
    // Given the scale of an earlier import, positions follow it exactly.
    const again = translate(apiDump(), { systemName, layoutScale: 2 }).plan;
    expect(system(again, SYS.c2).fields.position).toEqual({ x: 300, y: 0 });
  });

  it('maps connection types, mass, size, end of life and danger', () => {
    const { plan, report } = run();
    const readAt = Date.parse('2026-10-12T08:30:15.123Z');
    expect(connection(plan, SYS.home, SYS.c2)?.fields).toEqual({
      type: 'wormhole',
      timeStatus: 'eol',
      massStatus: 'reduced',
      shipSize: 'large',
      dangerous: false,
      bubbled: 'none',
      // "EOL 4h" marked at updated_at: Darkbeacon's 4 hours start then.
      eolAt: readAt,
      massStatusAt: readAt,
      locked: false,
      // Wanderer's custom info is the connection's note.
      note: 'Rolled once',
      lifetime: { mark: '4h', at: readAt },
    });
    const critical = connection(plan, SYS.home, SYS.c5)!;
    expect(critical.fields).toMatchObject({
      massStatus: 'critical',
      shipSize: 'xlarge',
      dangerous: true,
      bubbled: 'target',
      timeStatus: 'eol',
      lifetime: { mark: '1h', at: readAt },
      // No signature carries its U210: the note keeps it.
      note: 'Wormhole type: U210',
    });
    // "EOL 1h": three of Darkbeacon's four hours were gone when it was marked.
    expect(critical.fields.eolAt).toBe(readAt - 3 * 3_600_000);
    // "24 h" is a lifetime mark, not end of life; the lock comes over.
    expect(connection(plan, SYS.c2, SYS.hs)?.fields).toMatchObject({
      timeStatus: 'normal',
      shipSize: 'medium',
      locked: true,
      lifetime: { mark: '24h', at: readAt },
    });
    expect(connection(plan, SYS.jita, SYS.perimeter)?.fields.shipSize).toBe('capital');
    expect(connection(plan, SYS.jita, SYS.perimeter)?.fields.type).toBe('gate');
    expect(plan.connections.filter((c) => c.key === `${SYS.jita}-${SYS.perimeter}`)).toHaveLength(1);
    // A connection to a hidden system cannot exist here.
    expect(connection(plan, SYS.c2, SYS.c1)).toBeUndefined();
    expect(connection(plan, SYS.home, SYS.c2)?.extra).toEqual({ countOfPassage: 4 });

    expect(line(report, 'mapped', /Lifetime mark "less than 24h"/)).toBeDefined();
    expect(line(report, 'mapped', /^Lock$/)).toBeDefined();
    expect(line(report, 'mapped', /Note \(custom info\)/)).toBeDefined();
    // Passages: one by one where the source has them; a bare count is reported with why.
    expect(plan.passages).toEqual([
      {
        key: 'p-1',
        source: SYS.home,
        target: SYS.c2,
        characterId: 2112625428,
        shipTypeId: 605,
        occurredAt: Date.parse('2026-10-12T07:00:00Z'),
      },
    ]);
    expect(line(report, 'dropped', /Passage count without details/)).toBeUndefined();
    const counted = translate({ ...apiDump(), passages: [] }, { systemName }).report;
    expect(line(counted, 'dropped', /Passage count without details \(4\)/)?.why).toMatch(
      /how many ships passed/,
    );
    expect(line(report, 'dropped', /Connection to a hidden system/)).toBeDefined();
    expect(line(report, 'dropped', /Second connection/)).toBeDefined();
  });

  it('maps signatures, links them to connections and carries the wormhole type over', () => {
    const { plan, report } = run();
    expect(signature(plan, 'ABC-123')).toMatchObject({
      solarSystemId: SYS.home,
      linkedTo: SYS.c2,
      fields: { group: 'wormhole', type: 'O477', description: 'Bookmark: 1a' },
      extra: { customInfo: { time_status: 2, bookmark_index: 1 }, scannedBy: '2112625428' },
    });
    // Found by its system's Wanderer id; the id is upper-cased.
    expect(signature(plan, 'XYZ-789')).toMatchObject({
      solarSystemId: SYS.c2,
      fields: { group: 'wormhole', type: 'K162' },
    });
    expect(signature(plan, 'DEF-456')?.fields).toEqual({
      group: 'relic',
      type: null,
      name: 'Forgotten Perimeter Coronation Platform',
      description: 'Hacked half',
      kind: 'signature',
      custom: false,
    });
    expect(signature(plan, 'GHI-111')?.fields.group).toBe('gas');
    expect(signature(plan, 'OPQ-333')).toMatchObject({ solarSystemId: SYS.c1, fields: { group: 'ore' } });
    // Anomalies and every other scanner row come over by kind; ids that are not the scanner's
    // are custom entries.
    expect(signature(plan, 'JKL-222')?.fields).toMatchObject({ kind: 'anomaly', group: 'combat' });
    expect(signature(plan, 'MN-1')?.fields).toMatchObject({ kind: 'signature', custom: true, group: 'data' });
    expect(signature(plan, 'STU-555')?.fields).toMatchObject({
      kind: 'other',
      type: 'Structure',
      name: 'Astrahus',
    });
    expect(signature(plan, 'VWX-666')?.fields.description).toBe(
      'Wanderer marks: less than 16h left, leads to C5',
    );
    // Leads to Jita, but nothing connects the two here.
    expect(signature(plan, 'RST-444')?.linkedTo).toBeNull();

    expect(line(report, 'mapped', /Combat anomaly/)?.examples).toEqual(['JKL-222 in J130026']);
    expect(line(report, 'mapped', /Data signature \(custom entry\)/)).toBeDefined();
    expect(line(report, 'dropped', /Link to a system without a connection/)).toBeDefined();
    expect(line(report, 'approximated', /Wormhole type kept in the connection note/)?.examples[0]).toContain(
      'U210',
    );
  });

  it('turns ACL members into one access rule per subject', () => {
    const { plan, report } = run();
    const rule = (key: string) => plan.access.find((r) => r.key === key);
    expect(rule('character:2112625428')).toMatchObject({ role: 'admin', acls: ['Corp'] });
    expect(rule('corporation:98000001')).toMatchObject({ role: 'member' });
    expect(rule('alliance:99000001')).toMatchObject({ role: 'viewer' });
    // In two ACLs: the stronger role wins.
    expect(rule('character:2116161001')).toMatchObject({ role: 'manager', acls: ['Corp', 'Allies'] });
    expect(rule('character:2116161002')).toMatchObject({ role: 'blocked' });
    // Blocks come over 1:1: a corporation block beats every group grant in Darkbeacon too.
    expect(rule('corporation:98000002')?.note).toMatch(/only a character grant gets past it/);
    expect(line(report, 'mapped', /Corporation as blocked/)).toBeDefined();
    expect(line(report, 'approximated', /Block on a corporation/)).toBeUndefined();
    expect(rule('character:2116161009')).toBeUndefined();
    expect(line(report, 'dropped', /Role “owner”/)).toBeDefined();
    expect(line(report, 'dropped', /Members of the ACL “Officers”/)).toBeDefined();
    expect(plan.access.map((r) => r.role)).toEqual([
      'admin',
      'manager',
      'member',
      'viewer',
      'blocked',
      'blocked',
    ]);
  });

  it('maps settings and reports what has no place here', () => {
    const { plan, report } = run();
    expect(plan.hubs).toEqual([SYS.jita]);
    expect(plan.scopes).toEqual(['wormhole']);
    expect(plan.mapName).toBe('Home Chain');
    expect(line(report, 'dropped', /Unknown solar system/)?.examples).toEqual(['99999999']);
    expect(line(report, 'dropped', /Unreadable row/)?.count).toBe(1);
    expect(line(report, 'dropped', /Tracked characters \(3\)/)).toBeDefined();
    expect(plan.description).toBe(apiDump().map.description);
    expect(line(report, 'mapped', /Map description/)).toBeDefined();
    // Every line says what and, unless it came over as it was, why.
    for (const l of report) if (l.bucket !== 'mapped') expect(l.why, l.what).toBeTruthy();
  });

  it('brings webhooks over switched off, with the Darkbeacon events that match', () => {
    const dump = apiDump();
    dump.webhooks = [
      {
        id: 'a',
        url: 'https://hooks.example.com/x?token=t',
        events: ['add_system', 'signatures_updated'],
        active: true,
      },
      { id: 'b', url: 'https://hooks.example.com/kills', events: ['map_kill'], active: true },
      { id: 'c', url: 'ftp://files.example.com/', events: ['*'], active: true },
      {
        id: 'd',
        url: 'https://all.example.com/',
        events: ['*', 'acl_member_updated', 'rally_point_added'],
        active: false,
      },
      { id: null, url: 'https://none.example.com/', events: [], active: true },
    ];
    const { plan, report, counts } = translate(dump, { systemName });
    expect(plan.webhooks.map((w) => [w.key, w.events])).toEqual([
      ['a', ['system.added', 'signature.added', 'signature.updated', 'signature.removed']],
      ['d', ['system.*', 'connection.*', 'signature.*', 'access.rule_added', 'access.rule_removed']],
      [
        'url:https://none.example.com/',
        ['system.*', 'connection.*', 'signature.*', 'access.rule_added', 'access.rule_removed'],
      ],
    ]);
    expect(counts.webhooks).toBe(3);
    expect(line(report, 'approximated', /Webhook \(added switched off\)/)?.count).toBe(3);
    expect(line(report, 'dropped', /map_kill/)?.why).toMatch(/zKillboard/);
    expect(line(report, 'dropped', /no event Darkbeacon sends/)?.examples).toEqual([
      'https://hooks.example.com/…',
    ]);
    expect(line(report, 'dropped', /not http or https/)).toBeDefined();
    expect(line(report, 'dropped', /rally_point_added/)).toBeDefined();
    // Paths and queries (tokens) never reach the report.
    expect(JSON.stringify(report)).not.toContain('token=t');
  });

  it('shortens a map description past the limit', () => {
    const dump = apiDump();
    dump.map.description = 'x'.repeat(1500);
    const { plan, report } = translate(dump, { systemName });
    expect(plan.description).toHaveLength(1000);
    expect(line(report, 'approximated', /Map description/)?.why).toMatch(/1000/);
  });

  it('gives the same plan for the same map', () => {
    expect(run().plan).toEqual(run().plan);
  });
});
