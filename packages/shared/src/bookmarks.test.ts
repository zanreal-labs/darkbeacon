import { describe, expect, it } from 'vitest';
import {
  BOOKMARK_PREVIEW_VARS,
  BOOKMARK_TEMPLATE_PRESETS,
  BookmarkTemplate,
  bookmarkChain,
  bookmarkClassLabel,
  bookmarkLabel,
  renderBookmarkTemplate,
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

  it('labels: template, temporary name wins, nothing without a signature', () => {
    expect(bookmarkLabel('{sig}', chain.get(2)!)).toBe('ABC-123');
    expect(bookmarkLabel('{chainIndex} {destClass} {sig3}', chain.get(4)!)).toBe('2a HS XYZ');
    expect(bookmarkLabel('{sig}', chain.get(3)!)).toBe('Scout');
    expect(bookmarkLabel('{chainIndex} {tempName}', chain.get(3)!)).toBe('1b Scout');
    expect(bookmarkLabel('{sig}', chain.get(1)!)).toBeNull();
    expect(bookmarkLabel('{sig}', { ...chain.get(3)!, tempName: '' })).toBeNull();
    expect(bookmarkLabel('{chainIndex} {destClass}', { ...chain.get(3)!, tempName: '' })).toBe('1b C3');
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
});
