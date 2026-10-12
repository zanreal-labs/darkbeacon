import { describe, expect, it } from 'vitest';
import { ManualClock, type Actor, type EventLog, type MapAccess, type NewEvent } from '@darkbeacon/core';
import type { AuthorizationCode, OAuthClient, OAuthGrant, OAuthToken } from '../domain/oauth.js';
import type { OAuthSecrets, OAuthStore } from '../ports/index.js';
import { OAuthServer } from './oauth-server.js';

class MemoryStore implements OAuthStore {
  clients = new Map<string, OAuthClient>();
  grants = new Map<string, OAuthGrant>();
  codes = new Map<string, AuthorizationCode>();
  tokens = new Map<string, OAuthToken>();
  findClient = (id: string) => Promise.resolve(this.clients.get(id) ?? null);
  saveClient = (c: OAuthClient) => Promise.resolve(void this.clients.set(c.id, c));
  insertGrant = (g: OAuthGrant) => Promise.resolve(void this.grants.set(g.id, g));
  updateGrant = (g: OAuthGrant) => Promise.resolve(void this.grants.set(g.id, g));
  findGrant = (id: string) => Promise.resolve(this.grants.get(id) ?? null);
  listGrants = (a: string) => Promise.resolve([...this.grants.values()].filter((g) => g.accountId === a));
  touchGrant = () => Promise.resolve();
  insertCode = (c: AuthorizationCode) => Promise.resolve(void this.codes.set(c.lookup, c));
  findCode = (l: string) => Promise.resolve(this.codes.get(l) ?? null);
  useCode = (l: string, at: number) => {
    const c = this.codes.get(l);
    if (!c || c.usedAt !== null) return Promise.resolve(false);
    c.usedAt = at;
    return Promise.resolve(true);
  };
  insertToken = (t: OAuthToken) => Promise.resolve(void this.tokens.set(t.lookup, t));
  findToken = (l: string) => Promise.resolve(this.tokens.get(l) ?? null);
  useToken = () => Promise.resolve(true);
  prune = () => Promise.resolve(0);
}

let n = 0;
const secrets: OAuthSecrets = {
  random: (length) => `${++n}`.padStart(length, 'a'),
  hash: (s) => `h${s.length}:${s.slice(-6)}`,
  equals: (a, b) => a === b,
  s256: (v) => `s256:${v}`,
};
const events: EventLog = {
  append: (e: readonly NewEvent[]) => Promise.resolve(e.map((x, i) => ({ ...x, seq: i + 1, v: 1 as const }))),
  readSince: () => Promise.resolve([]),
  headSeq: () => Promise.resolve(0),
  oldestSeq: () => Promise.resolve(null),
  prune: () => Promise.resolve(0),
};
const access: MapAccess = { roleOf: () => Promise.resolve('admin'), mapsFor: () => Promise.resolve([]) };
const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };

function server(documents: Record<string, unknown>) {
  const fetched: string[] = [];
  const store = new MemoryStore();
  const oauth = new OAuthServer({
    store,
    secrets,
    metadata: {
      fetch: (url) => {
        fetched.push(url);
        return url in documents ? Promise.resolve(documents[url]) : Promise.reject(new Error('HTTP 404'));
      },
    },
    accounts: { find: (id) => Promise.resolve({ id, name: id, instanceRole: 'user' }) },
    maps: { describe: () => Promise.resolve([]) },
    access,
    uow: { transaction: (w) => w() },
    events,
    clock: new ManualClock(),
    publicUrl: 'https://map.example',
  });
  return { oauth, fetched, store };
}

const CLIENT = 'https://client.example/oauth/metadata.json';
const query = (over: Record<string, string> = {}) => ({
  response_type: 'code',
  client_id: CLIENT,
  redirect_uri: 'https://client.example/callback',
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
  ...over,
});

describe('OAuth clients by metadata document', () => {
  it('reads the document, checks it names itself and its redirect URIs, and keeps it an hour', async () => {
    const { oauth, fetched } = server({
      [CLIENT]: {
        client_id: CLIENT,
        client_name: 'Claude',
        redirect_uris: ['https://client.example/callback'],
      },
    });
    const described = await oauth.describe(alice, query());
    expect(described).toMatchObject({
      client: { name: 'Claude', kind: 'metadata' },
      redirectHost: 'client.example',
    });
    expect(described.scopes).toEqual(['*:read', 'account:read', 'universe:read']);
    await oauth.describe(alice, query());
    expect(fetched).toEqual([CLIENT]);
  });

  it('refuses documents that do not name the client or lack the redirect URI', async () => {
    const other = 'https://client.example/other.json';
    const { oauth } = server({
      [CLIENT]: { client_id: 'https://evil.example/x', redirect_uris: ['https://client.example/callback'] },
      [other]: { client_id: other, redirect_uris: ['https://client.example/elsewhere'] },
    });
    await expect(oauth.describe(alice, query())).rejects.toThrow(/does not name this client/);
    await expect(oauth.describe(alice, query({ client_id: other }))).rejects.toThrow(/redirect URI/);
    await expect(oauth.describe(alice, query({ client_id: 'https://gone.example/x' }))).rejects.toThrow(
      /could not be read/,
    );
    await expect(oauth.describe(alice, query({ client_id: 'not-a-client' }))).rejects.toThrow(
      /Unknown client/,
    );
  });

  it('insists on S256, a code response and this resource', async () => {
    const { oauth } = server({
      [CLIENT]: { client_id: CLIENT, redirect_uris: ['https://client.example/callback'] },
    });
    await expect(oauth.describe(alice, query({ code_challenge_method: 'plain' }))).rejects.toThrow(/S256/);
    await expect(oauth.describe(alice, query({ response_type: 'token' }))).rejects.toThrow(/response_type/);
    await expect(oauth.describe(alice, query({ resource: 'https://other.example/mcp' }))).rejects.toThrow(
      /only issues tokens/,
    );
    await expect(oauth.describe(alice, query({ scope: 'admin:*' }))).rejects.toThrow(/Administration/);
  });

  it('never lets an API key or an OAuth token approve clients', async () => {
    const { oauth } = server({
      [CLIENT]: { client_id: CLIENT, redirect_uris: ['https://client.example/callback'] },
    });
    const viaKey = {
      ...alice,
      grant: {
        credentialId: 'k',
        name: 'k',
        kind: 'pat',
        channel: 'api',
        scopes: ['*:*'],
        readOnly: false,
        allMaps: 'admin',
        maps: {},
      },
    } as Actor;
    await expect(oauth.describe(viaKey, query())).rejects.toMatchObject({ code: 'forbidden' });
  });
});
