import { beforeEach, describe, expect, it } from 'vitest';
import {
  ManualClock,
  capMapRole,
  type Actor,
  type DomainEvent,
  type EventLog,
  type GrantingMapRole,
  type InstanceRole,
  type MapAccess,
  type NewEvent,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { ApiKey } from '../domain/key.js';
import { TOKEN_PATTERN, crc32, formatToken, parseToken } from '../domain/token.js';
import type { ApiKeyRepository, KeyOwnerDirectory, MapNames, TokenSecrets } from '../ports/index.js';
import { ApiKeys } from './api-keys.js';

class MemoryKeys implements ApiKeyRepository {
  rows = new Map<string, ApiKey>();
  insert(key: ApiKey) {
    this.rows.set(key.id, structuredClone(key));
    return Promise.resolve();
  }
  update(key: ApiKey) {
    this.rows.set(key.id, structuredClone(key));
    return Promise.resolve();
  }
  findById(id: string) {
    return Promise.resolve(structuredClone(this.rows.get(id) ?? null));
  }
  findByLookup(lookup: string) {
    return Promise.resolve(structuredClone([...this.rows.values()].find((k) => k.lookup === lookup) ?? null));
  }
  listByOwner(accountId: string) {
    return Promise.resolve([...this.rows.values()].filter((k) => k.ownerAccountId === accountId));
  }
  listAll() {
    return Promise.resolve([...this.rows.values()]);
  }
  touch(id: string, at: number, ip: string | null) {
    const key = this.rows.get(id);
    if (key) Object.assign(key, { lastUsedAt: at, lastUsedIp: ip });
    return Promise.resolve();
  }
}

let counter = 0;
const secrets: TokenSecrets = {
  random: (length) => {
    counter++;
    const base = `${counter}`.padStart(4, '0') + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return base.slice(0, length);
  },
  hash: (secret) => `h:${crc32(secret).toString(16)}:${secret.length}`,
  equals: (a, b) => a === b,
};

class Events implements EventLog {
  readonly events: NewEvent[] = [];
  append(events: readonly NewEvent[]) {
    this.events.push(...events);
    return Promise.resolve(events.map((e, i) => ({ ...e, seq: i + 1, v: 1 as const })) as DomainEvent[]);
  }
  readSince = () => Promise.resolve([]);
  headSeq = () => Promise.resolve(0);
  oldestSeq = () => Promise.resolve(null);
  prune = () => Promise.resolve(0);
}

const uow: UnitOfWork = { transaction: (work) => work() };

/** Accounts and their own map roles: alice owns m1 and is a viewer on m2; bob is admin. */
const roles: Record<string, Record<string, GrantingMapRole>> = {
  alice: { m1: 'admin', m2: 'viewer' },
  bob: { m1: 'member' },
};
const instanceRoles: Record<string, InstanceRole> = { alice: 'user', bob: 'admin', owner: 'owner' };

/** A MapAccess like the access module's: own role, then the credential cap. */
const access: MapAccess = {
  roleOf: (actor, mapId) => {
    const own =
      actor.kind === 'account'
        ? (roles[actor.id]?.[mapId] ?? null)
        : actor.kind === 'apiToken'
          ? (actor.roles.maps[mapId] ?? actor.roles.allMaps)
          : null;
    return Promise.resolve(capMapRole(actor, mapId, own));
  },
  mapsFor: () => Promise.resolve([]),
};

const owners: KeyOwnerDirectory = {
  find: (id) => Promise.resolve(instanceRoles[id] ? { id, name: id, instanceRole: instanceRoles[id] } : null),
  names: (ids) => Promise.resolve(new Map(ids.map((id) => [id, id]))),
};
const maps: MapNames = {
  describe: (ids) =>
    Promise.resolve(
      ids.filter((id) => ['m1', 'm2'].includes(id)).map((id) => ({ id, name: `Map ${id}`, slug: id })),
    ),
};

const account = (id: string): Actor => ({ kind: 'account', id, instanceRole: instanceRoles[id] ?? 'user' });

describe('API key tokens', () => {
  it('formats tokens a secret scanner can recognise and checks their checksum', () => {
    const token = formatToken('pat', 'A'.repeat(12), 'b'.repeat(32));
    expect(token).toMatch(TOKEN_PATTERN);
    expect(parseToken(token)).toEqual({ kind: 'pat', lookup: 'A'.repeat(12), secret: 'b'.repeat(32) });
    const tampered = token.slice(0, 20) + (token[20] === 'b' ? 'c' : 'b') + token.slice(21);
    expect(parseToken(tampered)).toBeNull();
    expect(parseToken('dbk_xyz_' + 'a'.repeat(50))).toBeNull();
    expect(parseToken('ghp_abc')).toBeNull();
    expect(crc32('123456789')).toBe(0xcbf43926);
  });
});

describe('API keys', () => {
  let keys: MemoryKeys;
  let events: Events;
  let clock: ManualClock;
  let service: ApiKeys;

  beforeEach(() => {
    keys = new MemoryKeys();
    events = new Events();
    clock = new ManualClock();
    service = new ApiKeys({ keys, secrets, owners, maps, access, uow, events, clock });
  });

  const roleVia = async (token: string, mapId: string, ip: string | null = null) => {
    const { actor } = await service.authenticate(token, { ip, channel: 'api' });
    return access.roleOf(actor, mapId);
  };

  it('shows a token once, stores only its hash and audits the key', async () => {
    const created = await service.createPersonal(account('alice'), {
      name: 'Bot',
      scopes: ['maps:read'],
      readOnly: false,
      allowedIps: [],
    });
    expect(created.token).toMatch(TOKEN_PATTERN);
    const stored = [...keys.rows.values()][0]!;
    expect(JSON.stringify(stored)).not.toContain(parseToken(created.token)!.secret.slice(4));
    expect(created.key).toMatchObject({
      name: 'Bot',
      status: 'active',
      ownerAccountId: 'alice',
      prefix: expect.stringMatching(/^dbk_pat_/),
    });
    expect(JSON.stringify(created.key)).not.toContain(created.token);
    expect(events.events.map((e) => e.type)).toEqual(['api_key.created']);
    expect(JSON.stringify(events.events)).not.toContain(created.token);
  });

  it('never lets a personal token exceed its owner', async () => {
    // Asking for more than the owner has is refused at creation...
    await expect(
      service.createPersonal(account('alice'), {
        name: 'x',
        scopes: ['admin:*'],
        readOnly: false,
        allowedIps: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      service.createPersonal(account('alice'), {
        name: 'x',
        scopes: ['map:m3:maps:read'],
        readOnly: false,
        allowedIps: [],
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      service.createPersonal(account('alice'), {
        name: 'x',
        scopes: ['map:m2:systems:write'],
        readOnly: false,
        allowedIps: [],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // ...and an all-maps write key is still only a viewer where its owner is one.
    const { token } = await service.createPersonal(account('alice'), {
      name: 'x',
      scopes: ['*:*'],
      readOnly: false,
      allowedIps: [],
    });
    expect(await roleVia(token, 'm1')).toBe('admin');
    expect(await roleVia(token, 'm2')).toBe('viewer');
    expect(await roleVia(token, 'm3')).toBeNull();
    const { actor } = await service.authenticate(token, { ip: null, channel: 'api' });
    expect(actor).toMatchObject({ kind: 'account', id: 'alice', instanceRole: 'user' });

    // Admin scopes count only for admins, and never as owner.
    const admin = await service.createPersonal(account('owner'), {
      name: 'a',
      scopes: ['admin:read'],
      readOnly: false,
      allowedIps: [],
    });
    const noAdmin = await service.createPersonal(account('owner'), {
      name: 'b',
      scopes: ['maps:read'],
      readOnly: false,
      allowedIps: [],
    });
    expect((await service.authenticate(admin.token, { ip: null, channel: 'api' })).actor).toMatchObject({
      instanceRole: 'admin',
    });
    expect((await service.authenticate(noAdmin.token, { ip: null, channel: 'api' })).actor).toMatchObject({
      instanceRole: 'user',
    });
  });

  it('scopes a key to one map and caps the role it can use there', async () => {
    const { token } = await service.createPersonal(account('alice'), {
      name: 'm1 sigs',
      scopes: ['map:m1:signatures:write'],
      readOnly: false,
      allowedIps: [],
    });
    expect(await roleVia(token, 'm1')).toBe('member');
    expect(await roleVia(token, 'm2')).toBeNull();
    const readOnly = await service.createPersonal(account('alice'), {
      name: 'ro',
      scopes: ['map:m1:*'],
      readOnly: true,
      allowedIps: [],
    });
    expect(await roleVia(readOnly.token, 'm1')).toBe('viewer');
  });

  it('refuses expired, revoked, rotated-away keys and keys used from elsewhere', async () => {
    const expiring = await service.createPersonal(account('alice'), {
      name: 'soon',
      scopes: ['maps:read'],
      readOnly: false,
      allowedIps: [],
      expiresAt: clock.now() + 1000,
    });
    expect(await roleVia(expiring.token, 'm1')).toBe('viewer');
    clock.advance(1000);
    await expect(service.authenticate(expiring.token, { ip: null, channel: 'api' })).rejects.toThrow(
      /expired/,
    );
    await expect(
      service.createPersonal(account('alice'), {
        name: 'past',
        scopes: ['maps:read'],
        readOnly: false,
        allowedIps: [],
        expiresAt: clock.now() - 1,
      }),
    ).rejects.toMatchObject({ code: 'validation' });

    const office = await service.createPersonal(account('alice'), {
      name: 'office',
      scopes: ['maps:read'],
      readOnly: false,
      allowedIps: ['203.0.113.0/24', '2001:db8::/32'],
    });
    expect(await roleVia(office.token, 'm1', '203.0.113.20')).toBe('viewer');
    expect(await roleVia(office.token, 'm1', '2001:db8::5')).toBe('viewer');
    await expect(service.authenticate(office.token, { ip: '198.51.100.1', channel: 'api' })).rejects.toThrow(
      /address/,
    );
    await expect(service.authenticate(office.token, { ip: null, channel: 'api' })).rejects.toThrow(/address/);

    const rotated = await service.rotateOwn(account('alice'), office.key.id);
    await expect(service.authenticate(office.token, { ip: '203.0.113.20', channel: 'api' })).rejects.toThrow(
      /Invalid/,
    );
    expect(await roleVia(rotated.token, 'm1', '203.0.113.20')).toBe('viewer');

    await service.revokeOwn(account('alice'), office.key.id);
    await expect(service.authenticate(rotated.token, { ip: '203.0.113.20', channel: 'api' })).rejects.toThrow(
      /revoked/,
    );
    expect((await service.listOwn(account('alice'))).find((k) => k.id === office.key.id)?.status).toBe(
      'revoked',
    );
  });

  it('fails unknown and malformed tokens alike', async () => {
    const { token } = await service.createPersonal(account('alice'), {
      name: 'x',
      scopes: ['maps:read'],
      readOnly: false,
      allowedIps: [],
    });
    const parsed = parseToken(token)!;
    const wrongSecret = formatToken('pat', parsed.lookup, 'z'.repeat(32));
    const unknown = formatToken('pat', 'Z'.repeat(12), parsed.secret);
    const otherKind = formatToken('svc', parsed.lookup, parsed.secret);
    for (const bad of [wrongSecret, unknown, otherKind, 'dbk_pat_short', 'nonsense']) {
      await expect(service.authenticate(bad, { ip: null, channel: 'api' })).rejects.toThrow(
        'Invalid API key',
      );
    }
  });

  it('keeps keys to their owners and to browser sessions', async () => {
    const { key, token } = await service.createPersonal(account('alice'), {
      name: 'x',
      scopes: ['*:*'],
      readOnly: false,
      allowedIps: [],
    });
    await expect(service.revokeOwn(account('bob'), key.id)).rejects.toMatchObject({ code: 'not_found' });
    const { actor } = await service.authenticate(token, { ip: null, channel: 'api' });
    // A key cannot make or list keys, even with every scope.
    await expect(service.listOwn(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      service.createPersonal(actor, { name: 'y', scopes: ['maps:read'], readOnly: false, allowedIps: [] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Admins see every key and revoke any of them.
    await expect(service.listAll(account('alice'))).rejects.toMatchObject({ code: 'forbidden' });
    expect((await service.listAll(account('bob'))).map((k) => k.id)).toContain(key.id);
    await service.revokeAny(account('bob'), key.id);
    await expect(service.authenticate(token, { ip: null, channel: 'api' })).rejects.toThrow(/revoked/);
  });

  it('binds service keys to the roles an admin gives them', async () => {
    await expect(
      service.createService(account('alice'), {
        name: 's',
        scopes: ['maps:read'],
        readOnly: false,
        allowedIps: [],
        instanceRole: 'user',
        mapGrants: [],
        allMapsRole: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const { token, key } = await service.createService(account('bob'), {
      name: 'Discord bot',
      scopes: ['*:read', 'map:m1:signatures:write'],
      readOnly: false,
      allowedIps: [],
      instanceRole: 'user',
      mapGrants: [
        { mapId: 'm1', role: 'member' },
        { mapId: 'm2', role: 'viewer' },
      ],
      allMapsRole: null,
    });
    expect(key.maps.map((m) => m.name)).toEqual(['Map m1', 'Map m2']);
    expect(token.startsWith('dbk_svc_')).toBe(true);
    const { actor } = await service.authenticate(token, { ip: null, channel: 'mcp' });
    expect(actor).toMatchObject({
      kind: 'apiToken',
      id: key.id,
      instanceRole: 'user',
      grant: { channel: 'mcp', name: 'Discord bot' },
    });
    expect(await access.roleOf(actor, 'm1')).toBe('member');
    expect(await access.roleOf(actor, 'm2')).toBe('viewer');
    expect(await access.roleOf(actor, 'm3')).toBeNull();
    await expect(
      service.createService(account('bob'), {
        name: 'bad',
        scopes: ['federation:*'],
        readOnly: false,
        allowedIps: [],
        instanceRole: 'user',
        mapGrants: [],
        allMapsRole: null,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
