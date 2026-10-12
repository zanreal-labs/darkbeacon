import { describe, expect, it } from 'vitest';
import {
  BOOKMARK_PREVIEW_VARS,
  BOOKMARK_TEMPLATE_PRESETS,
  BookmarkTemplate,
  bookmarkChain,
  bookmarkClassLabel,
  bookmarkLabel,
  renderBookmarkTemplate,
  systemLabelsText,
} from './dto/bookmarks.js';
import type { ConnectionDto, MapSystemDto, SignatureDto } from './dto/mapping.js';

const system = (id: number, extra: Partial<MapSystemDto> = {}): MapSystemDto => ({
  mapId: 'm',
  solarSystemId: id,
  position: { x: 0, y: 0 },
  customName: null,
  temporaryName: null,
  tag: null,
  status: 'unknown',
  description: '',
  labelIds: [],
  systemLabelIds: [],
  customLabel: null,
  locked: false,
  visible: true,
  createdAt: id,
  updatedAt: id,
  ...extra,
});

const connection = (id: string, source: number, target: number, extra: Partial<ConnectionDto> = {}) =>
  ({
    id,
    mapId: 'm',
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
  }) satisfies ConnectionDto;

const signature = (solarSystemId: number, eveId: string, connectionId: string, type: string | null) =>
  ({
    id: eveId,
    mapId: 'm',
    solarSystemId,
    eveId,
    group: 'wormhole',
    type,
    name: null,
    description: '',
    connectionId,
    createdAt: 1,
    updatedAt: 1,
  }) satisfies SignatureDto;

describe('bookmark templates', () => {
  it('accept known variables only, and at least one', () => {
    expect(BookmarkTemplate.safeParse('{chainIndex} {sig}').success).toBe(true);
    expect(BookmarkTemplate.safeParse('{sigg}').error?.issues[0]?.message).toBe('Unknown variable {sigg}');
    expect(BookmarkTemplate.safeParse('plain').error?.issues[0]?.message).toBe('Use at least one variable');
    expect(BookmarkTemplate.safeParse('{sig}'.repeat(20)).success).toBe(false);
    for (const preset of BOOKMARK_TEMPLATE_PRESETS) expect(BookmarkTemplate.parse(preset)).toBe(preset);
  });

  it('render the examples from the settings and drop empty parts', () => {
    const vars = BOOKMARK_PREVIEW_VARS;
    expect(renderBookmarkTemplate('{sig}', vars)).toBe('ABC-123');
    expect(renderBookmarkTemplate('{sig3} {destClass}', vars)).toBe('ABC C3');
    expect(renderBookmarkTemplate('{chainIndex} {sig}', vars)).toBe('1a ABC-123');
    expect(renderBookmarkTemplate('{destClass} {sig3}', vars)).toBe('C3 ABC');
    expect(renderBookmarkTemplate('{sig3} {destClass} {mass} {eol}', vars)).toBe('ABC C3');
    expect(renderBookmarkTemplate('{sig3} {eol}', { ...vars, eol: 'EOL' })).toBe('ABC EOL');
  });

  it('name classes the way pilots write them', () => {
    expect(bookmarkClassLabel({ whClass: 3, security: -1 })).toBe('C3');
    expect(bookmarkClassLabel({ whClass: 7, security: 0.5 })).toBe('HS');
    expect(bookmarkClassLabel({ whClass: 8, security: 0.3 })).toBe('LS');
    expect(bookmarkClassLabel({ whClass: 9, security: -0.2 })).toBe('NS');
    expect(bookmarkClassLabel({ whClass: 12, security: -1 })).toBe('Thera');
    expect(bookmarkClassLabel(undefined)).toBe('');
  });
});

describe('bookmarkChain', () => {
  // home(1) -> 2 (ABC-123, O477) -> 4 ; home -> 3 (no signature yet, EOL, frigate)
  const systems = [
    system(2),
    system(1, { status: 'home', createdAt: 5 }),
    system(3, { temporaryName: 'Scout' }),
    system(4),
  ];
  const connections = [
    connection('a', 1, 2, { createdAt: 1 }),
    connection('b', 3, 1, { createdAt: 2, timeStatus: 'eol', shipSize: 'small', massStatus: 'critical' }),
    connection('c', 2, 4, { createdAt: 3 }),
  ];
  const signatures = [
    signature(1, 'ABC-123', 'a', 'O477'),
    signature(2, 'KCX-162', 'a', 'K162'),
    signature(2, 'XYZ-777', 'c', null),
  ];
  const chain = bookmarkChain({
    systems,
    connections,
    signatures,
    classOf: (id) => (id === 4 ? 'HS' : 'C3'),
  });

  it('walks from home and names each hole from its parent side', () => {
    expect(chain.get(1)).toMatchObject({ root: true, chainIndex: '0', sig: '' });
    expect(chain.get(2)).toMatchObject({ chainIndex: '1a', sig: 'ABC-123', sig3: 'ABC', type: 'O477' });
    expect(chain.get(3)).toMatchObject({
      chainIndex: '1b',
      sig: '',
      eol: 'EOL',
      size: 'F',
      mass: 'crit',
      tempName: 'Scout',
    });
    expect(chain.get(4)).toMatchObject({ chainIndex: '2a', sig: 'XYZ-777', destClass: 'HS' });
  });

  it('knows direction, spawn, letters, same-class indexes, counting from 0 and value mappings', () => {
    const extra = bookmarkChain({
      systems: [system(1, { status: 'home' }), system(2), system(3), system(5)],
      connections: [
        connection('a', 1, 2, { bookmarkNumber: 1, bookmarkParent: 1 }),
        connection('b', 1, 3, { bookmarkNumber: 2, bookmarkParent: 1 }),
        connection('d', 1, 5, { bookmarkNumber: 3, bookmarkParent: 1 }),
      ],
      signatures: [
        signature(1, 'BBB-200', 'a', 'D845'),
        signature(1, 'AAA-100', 'b', 'E004'),
        signature(1, 'CCC-300', 'd', 'K162'),
      ],
      classOf: (id) => (id === 5 ? 'C2' : 'HS'),
      staticsOf: () => ['D845', 'U210'],
      startAtZero: true,
    });
    expect(extra.get(2)).toMatchObject({
      direction: 'Out',
      spawn: 'Static',
      n: '0',
      letter: 'A',
      destClassIndex: 'b',
    });
    expect(extra.get(3)).toMatchObject({ spawn: 'Wandering', n: '1', letter: 'B', destClassIndex: 'a' });
    expect(extra.get(5)).toMatchObject({ direction: 'In', spawn: 'K162', destClassIndex: '' });
    const values = { 'destClass:HS': 'H', 'spawn:Static': 'S', 'direction:Out': ' ' };
    expect(bookmarkLabel('{n}{destClass}{destClassIndex} {spawn} {direction}', extra.get(2)!, values)).toBe(
      '0Hb S',
    );
  });

  it('labels: template, temporary name wins, nothing without a signature', () => {
    expect(bookmarkLabel('{sig}', chain.get(2)!)).toBe('ABC-123');
    expect(bookmarkLabel('{chainIndex} {destClass} {sig3}', chain.get(4)!)).toBe('2a HS XYZ');
    expect(bookmarkLabel('{sig}', chain.get(3)!)).toBe('Scout');
    expect(bookmarkLabel('{chainIndex} {tempName}', chain.get(3)!)).toBe('1b Scout');
    expect(bookmarkLabel('{sig}', chain.get(1)!)).toBeNull();
    expect(bookmarkLabel('{sig}', { ...chain.get(3)!, tempName: '' })).toBeNull();
    expect(bookmarkLabel('{chainIndex} {destClass}', { ...chain.get(3)!, tempName: '' })).toBe('1b C3');
  });

  it("offers {labels}: the system's Labels in the map's order, then its custom label", () => {
    const labelled = bookmarkChain({
      systems: [
        system(1, { status: 'home' }),
        system(2, { systemLabelIds: ['b', 'a'], customLabel: 'bait' }),
      ],
      connections: [connection('a', 1, 2)],
      signatures: [signature(1, 'ABC-123', 'a', null)],
      classOf: () => 'C3',
      systemLabels: [
        { id: 'a', name: 'WH1', description: '' },
        { id: 'b', name: 'WH2', description: '' },
      ],
    });
    expect(labelled.get(2)!.labels).toBe('WH1 WH2 bait');
    expect(bookmarkLabel('{labels} {sig3}', labelled.get(2)!)).toBe('WH1 WH2 bait ABC');
    expect(systemLabelsText({ systemLabelIds: ['a'], customLabel: null })).toBe('');
    expect(BookmarkTemplate.parse('{labels} {sig}')).toBe('{labels} {sig}');
  });

  it('starts a part of the map without a home at its oldest system and skips hidden ones', () => {
    const lone = bookmarkChain({
      systems: [system(9, { createdAt: 1 }), system(8, { createdAt: 2 }), system(7, { visible: false })],
      connections: [connection('x', 8, 9), connection('y', 8, 7)],
      signatures: [signature(9, 'QQQ-111', 'x', null)],
      classOf: () => 'C2',
    });
    expect(lone.get(9)?.root).toBe(true);
    expect(lone.get(8)).toMatchObject({ chainIndex: '1a', sig: 'QQQ-111' });
    expect(lone.has(7)).toBe(false);
  });

  describe('{n}', () => {
    // home(1) -> 2 (#3, XYZ, HS), 3 (#1, ABC, C3), 4 (#2, no signature, LS); 4 -> 5 by stargate.
    const systems = [system(1, { status: 'home' }), system(2), system(3), system(4), system(5)];
    const connections = [
      connection('a', 1, 2, { createdAt: 1, bookmarkNumber: 3, bookmarkParent: 1 }),
      connection('b', 1, 3, { createdAt: 2, bookmarkNumber: 1, bookmarkParent: 1 }),
      connection('c', 4, 1, { createdAt: 3, bookmarkNumber: 2, bookmarkParent: 1 }),
      connection('d', 4, 5, { createdAt: 4, type: 'gate' }),
    ];
    const signatures = [signature(1, 'XYZ-777', 'a', null), signature(1, 'ABC-123', 'b', null)];
    const classOf = (id: number) => ({ 2: 'HS', 3: 'C3', 4: 'LS' })[id] ?? 'NS';
    const label = (template: string, vars: ReturnType<typeof bookmarkChain>, id: number) =>
      bookmarkLabel(template, vars.get(id)!);

    it('shows the number the server keeps, the same for everyone', () => {
      const chain = bookmarkChain({ systems, connections, signatures, classOf });
      expect([2, 3, 4].map((id) => label('WH{n}', chain, id))).toEqual(['WH3', 'WH1', 'WH2']);
      expect(label('WH{N} {destClass}', chain, 2)).toBe('WH03 HS');
      expect(label('{n} {sig3}', chain, 3)).toBe('1 ABC');
      // Stargates have no number, so nothing to show; nor does home.
      expect(label('WH{n}', chain, 5)).toBeNull();
      expect(label('WH{n}', chain, 1)).toBeNull();
      // A number given for another parent (the chain turned since) is not shown.
      const turned = bookmarkChain({
        systems,
        connections: connections.map((c) => (c.id === 'a' ? { ...c, bookmarkParent: 2 } : c)),
        signatures,
        classOf,
      });
      expect(label('WH{n}', turned, 2)).toBeNull();
    });

    it("counts in the viewer's own order on their screen", () => {
      const own = (order: 'found' | 'signature' | 'class' | 'manual') =>
        [2, 3, 4].map((id) =>
          label('WH{n}', bookmarkChain({ systems, connections, signatures, classOf, order }), id),
        );
      expect(own('found')).toEqual(['WH1', 'WH2', 'WH3']);
      expect(own('signature')).toEqual(['WH2', 'WH1', 'WH3']);
      expect(own('class')).toEqual(['WH1', 'WH3', 'WH2']);
      expect(own('manual')).toEqual(['WH3', 'WH1', 'WH2']);
    });
  });
});
