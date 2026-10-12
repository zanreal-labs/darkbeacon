import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@darkbeacon/core';
import type { ShareScope } from '@darkbeacon/shared';
import { projectEvent, projectSnapshot } from './projection.js';
import { DEFAULT_SHARE_SCOPES, effectiveMcpMode, normalizeScopes } from './share.js';

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
  createdAt: 1,
  updatedAt: 2,
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
  signatures: [signature],
  characters: [character],
  exits: [exit],
  plugin: { secret: SECRETS.note },
};

const scopes = (...extra: ShareScope[]) => new Set<ShareScope>([...DEFAULT_SHARE_SCOPES, ...extra]);
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
    expect(view.connections[0]).toMatchObject({
      massStatus: 'critical',
      timeStatus: 'eol',
      dangerous: false,
      bubbled: 'none',
    });
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
    });
    expect(view.connections[0]).not.toHaveProperty('massStatusAt');
  });

  it('adds exactly what each scope shares', () => {
    const withSigs = projectSnapshot(snapshot, scopes('signatures'));
    expect(leaks(withSigs, [SECRETS.sigName])).toEqual([]);
    expect(withSigs.signatures![0]!.description).toBe('');
    const withIntel = projectSnapshot(snapshot, scopes('intel', 'signatures'));
    expect(withIntel.systems[0]!.description).toBe(SECRETS.note);
    expect(withIntel.signatures![0]!.description).toBe(SECRETS.sigNote);
    const withPilots = projectSnapshot(snapshot, scopes('characters'));
    expect(withPilots.characters![0]!.name).toBe(SECRETS.pilot);
    expect(leaks(withPilots, [SECRETS.pilot])).toEqual([]);
    const withLabels = projectSnapshot(snapshot, scopes('labels'));
    expect(withLabels.systems[0]!.labelIds).toEqual(['l1']);
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
      projectEvent(event('access.sharing_changed', { mapId: 'm', slug: 'x' }), s, 'public:tok')!.data,
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
