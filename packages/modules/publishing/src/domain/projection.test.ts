import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@darkbeacon/core';
import type { ShareScope } from '@darkbeacon/shared';
import { projectEvent, projectSnapshot } from './projection.js';
import { DEFAULT_PUBLIC_SCOPES, effectiveMcpMode, normalizeScopes } from './link.js';

/** Values that must never leave the server unless a scope shares them. */
const SECRETS = {
  note: 'SECRET-NOTE-hostile-titan-here',
  tag: 'SECRET-TAG',
  customName: 'SECRET-HOME-NAME',
  temporaryName: 'SECRET-BOOKMARK',
  pilot: 'SECRET-PILOT-NAME',
  account: 'secret-account-id',
  sigName: 'SECRET-SIG-SITE',
  sigNote: 'SECRET-SIG-NOTE',
  label: 'SECRET-LABEL',
  mapHub: 'SECRET-STAGING',
  connectionNote: 'SECRET-CONNECTION-NOTE',
};

const system = {
  mapId: 'm',
  solarSystemId: 31000005,
  position: { x: 10, y: 20 },
  customName: SECRETS.customName,
  temporaryName: SECRETS.temporaryName,
  tag: SECRETS.tag,
  status: 'hostile' as const,
  description: SECRETS.note,
  labelIds: ['l1'],
  locked: true,
  visible: true,
  createdAt: 1,
  updatedAt: 2,
};
const connection = {
  id: 'c1',
  mapId: 'm',
  source: 31000005,
  target: 30000142,
  type: 'wormhole' as const,
  timeStatus: 'eol' as const,
  massStatus: 'critical' as const,
  shipSize: 'medium' as const,
  massSaved: true,
  dangerous: true,
  bubbled: 'source' as const,
  eolAt: 5,
  massStatusAt: 6,
  lifetime: { mark: '16h' as const, at: 4 },
  locked: true,
  note: SECRETS.connectionNote,
  createdAt: 1,
  updatedAt: 2,
};
const signature = {
  id: 's1',
  mapId: 'm',
  solarSystemId: 31000005,
  eveId: 'ABC-123',
  group: 'relic' as const,
  type: null,
  name: SECRETS.sigName,
  description: SECRETS.sigNote,
  connectionId: null,
  kind: 'anomaly' as const,
  createdAt: 1,
  updatedAt: 2,
};
const custom = {
  ...signature,
  id: 's2',
  eveId: 'TOWER-1',
  kind: undefined,
  custom: true,
  name: SECRETS.sigName,
};
const character = {
  characterId: 90000001,
  accountId: SECRETS.account,
  name: SECRETS.pilot,
  solarSystemId: 31000005,
  shipTypeId: 670,
  shipName: 'Pod',
  online: true,
  updatedAt: 3,
};
const hub = (name: string, kind: 'trade' | 'map') => ({
  solarSystemId: 1,
  name,
  security: 1,
  kind,
  near: null,
  jumps: 3,
});
const exit = {
  kind: 'connected' as const,
  solarSystemId: 30000142,
  name: 'Jita',
  security: 0.9,
  whClass: 7,
  classLabel: 'HS',
  connectionId: 'c1',
  chainSystemId: 31000005,
  statics: [],
  nearest: hub(SECRETS.mapHub, 'map'),
  hubs: [hub(SECRETS.mapHub, 'map'), hub('Jita', 'trade')],
};
const snapshot = {
  map: {
    id: 'm',
    name: 'Chain',
    ownerAccountId: SECRETS.account,
    labels: [{ id: 'l1', name: SECRETS.label, color: '#ffffff', description: '' }],
  },
  systems: [system],
  connections: [connection],
  signatures: [signature, custom],
  characters: [character],
  exits: [exit],
  plugin: { secret: SECRETS.note },
};

const scopes = (...extra: ShareScope[]) => new Set<ShareScope>([...DEFAULT_PUBLIC_SCOPES, ...extra]);
const leaks = (value: unknown, allowed: string[] = []) =>
  Object.values(SECRETS).filter((s) => !allowed.includes(s) && JSON.stringify(value).includes(s));

describe('public projection', () => {
  it('shares the chain and its connection status by default, nothing else', () => {
    const view = projectSnapshot(snapshot, scopes());
    expect(leaks(view)).toEqual([]);
    expect(view.systems[0]).toMatchObject({
      solarSystemId: 31000005,
      position: { x: 10, y: 20 },
      status: 'unknown',
      description: '',
      labelIds: [],
    });
    // Danger and bubbles are connection status, as in shares between maps.
    expect(view.connections[0]).toMatchObject({
      massStatus: 'critical',
      timeStatus: 'eol',
      dangerous: true,
      bubbled: 'source',
      // Lifetime marks are connection status too.
      lifetime: { mark: '16h', at: 4 },
    });
    // Connection notes are intel; locks never leave their map.
    expect(view.connections[0]).not.toHaveProperty('note');
    expect(view.connections[0]).not.toHaveProperty('locked');
    expect(view.signatures).toBeUndefined();
    expect(view.characters).toBeUndefined();
    expect(view.exits![0]!.hubs.map((h) => h.name)).toEqual(['Jita']);
    expect(Object.keys(view).sort()).toEqual(['connections', 'exits', 'systems']);
  });

  it('blanks connection status when it is not shared', () => {
    const view = projectSnapshot(snapshot, new Set<ShareScope>(['topology']));
    expect(view.connections[0]).toMatchObject({
      massStatus: 'fresh',
      timeStatus: 'normal',
      eolAt: null,
      massSaved: false,
      dangerous: false,
      bubbled: 'none',
    });
    expect(view.connections[0]).not.toHaveProperty('massStatusAt');
    expect(view.connections[0]).not.toHaveProperty('lifetime');
  });

  it('adds exactly what each scope shares', () => {
    const withSigs = projectSnapshot(snapshot, scopes('signatures'));
    // Signature notes travel with signatures (sharing's FIELD_SCOPES).
    expect(leaks(withSigs, [SECRETS.sigName, SECRETS.sigNote])).toEqual([]);
    expect(withSigs.signatures![0]!.description).toBe(SECRETS.sigNote);
    // Anomalies and custom entries are signatures, with their kind and flag.
    expect(withSigs.signatures!.map((x) => [x.eveId, x.kind, x.custom])).toEqual([
      ['ABC-123', 'anomaly', undefined],
      ['TOWER-1', undefined, true],
    ]);
    const withIntel = projectSnapshot(snapshot, scopes('intel', 'signatures'));
    expect(withIntel.systems[0]!.description).toBe(SECRETS.note);
    expect(withIntel.signatures![0]!.description).toBe(SECRETS.sigNote);
    expect(withIntel.connections[0]!.note).toBe(SECRETS.connectionNote);
    const withPilots = projectSnapshot(snapshot, scopes('characters'));
    expect(withPilots.characters![0]!.name).toBe(SECRETS.pilot);
    expect(leaks(withPilots, [SECRETS.pilot])).toEqual([]);
    // `labels` are bookmark labels (temporary names); label assignments and locks never leave.
    const withLabels = projectSnapshot(snapshot, scopes('labels'));
    expect(withLabels.systems[0]!.temporaryName).toBe(SECRETS.temporaryName);
    expect(leaks(withLabels, [SECRETS.temporaryName])).toEqual([]);
    const everything = projectSnapshot(snapshot, scopes('signatures', 'intel', 'characters', 'labels'));
    expect(everything.systems[0]).toMatchObject({ labelIds: [], locked: false });
    expect(everything.connections[0]).not.toHaveProperty('locked');
    expect(
      leaks(
        everything,
        Object.values(SECRETS).filter((s) => s !== SECRETS.account && s !== SECRETS.label),
      ),
    ).toEqual([]);
  });

  it('forwards only shared events, without who made them', () => {
    const event = (type: string, data: unknown): DomainEvent => ({
      id: 'e',
      seq: 7,
      stream: 'map:m',
      type,
      occurredAt: 1,
      actor: { kind: 'account', id: SECRETS.account },
      data,
      v: 1,
    });
    const s = scopes();
    const updated = projectEvent(event('system.updated', system), s, 'public:tok')!;
    expect(updated).toMatchObject({
      stream: 'public:tok',
      seq: 7,
      actor: { kind: 'system', id: 'darkbeacon' },
    });
    expect(leaks(updated)).toEqual([]);
    for (const type of [
      'signature.added',
      'character.tracked',
      'character.jumped',
      'connection.passage',
      'map.settings_changed',
      'access.rule_added',
      'ping.created',
      'routes.hubs_changed',
      'labels.changed',
      'plugin.updated',
      'something.new',
    ]) {
      expect(projectEvent(event(type, { name: SECRETS.pilot }), s, 'public:tok'), type).toBeNull();
    }
    expect(
      projectEvent(event('access.public_link_changed', { mapId: 'm', slug: 'x' }), s, 'public:tok')!.data,
    ).toEqual({});
    expect(
      projectEvent(event('map.sources_changed', { sources: [{ name: SECRETS.pilot }] }), s, 'public:tok')!
        .data,
    ).toEqual({});
    expect(leaks(projectEvent(event('routes.exits_changed', { exits: [exit] }), s, 'public:tok'))).toEqual(
      [],
    );
  });

  it('normalizes scopes and narrows the MCP reach', () => {
    expect(normalizeScopes(['labels', 'intel', 'labels'])).toEqual(['topology', 'intel', 'labels']);
    expect(effectiveMcpMode('authenticated', 'public')).toBe('authenticated');
    expect(effectiveMcpMode('public', 'off')).toBe('off');
    expect(effectiveMcpMode('public', 'public')).toBe('public');
  });
});
