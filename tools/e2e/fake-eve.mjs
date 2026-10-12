// A stand-in for EVE SSO (login.eveonline.com) and the few ESI routes Darkbeacon calls, for the
// end-to-end test of an EVE-only instance. It answers over HTTPS with a throwaway certificate the
// instance trusts through NODE_EXTRA_CA_CERTS (see README.md); the container running it carries
// the network aliases login.eveonline.com and esi.evetech.net.
//
// Shapes follow the live ESI OpenAPI spec (https://esi.evetech.net/meta/openapi.json) and the EVE
// SSO documentation (https://developers.eveonline.com/docs/services/sso/); the server's own fake
// (apps/server/src/adapters/identity/fake-network.ts) is the reference for what it checks.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';

const KID = 'JWT-Signature-Key';
const SEARCH_SCOPE = 'esi-search.search_structures.v1';

/** The pilot who signs in, with what ESI knows about everyone the test searches for. */
export const PILOT = { id: 2112000001, name: 'E2E Pilot', owner: 'e2e-owner-hash', corporationId: 98000001 };
export const ENTITIES = new Map([
  [PILOT.id, { name: PILOT.name, category: 'character' }],
  [98000001, { name: 'E2E Logistics', category: 'corporation', ticker: 'E2EL' }],
  [98000002, { name: 'Logistics Union', category: 'corporation', ticker: 'LOGU' }],
  [99000001, { name: 'E2E Alliance', category: 'alliance', ticker: 'E2EA' }],
]);

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });

/**
 * Starts the fake on :443. `client` is the instance's EVE client id and secret; every authorize
 * request is approved at once as PILOT, with the scopes the instance asked for.
 */
export function startFakeEve({ client, certFile, keyFile, port = 443 }) {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map();
  const refresh = new Map();
  const calls = [];

  const jwt = (scopes) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const head = encode({ alg: 'RS256', kid: KID, typ: 'JWT' });
    const body = encode({
      scp: scopes,
      jti: randomBytes(8).toString('hex'),
      kid: KID,
      sub: `CHARACTER:EVE:${PILOT.id}`,
      azp: client.id,
      tenant: 'tranquility',
      tier: 'live',
      region: 'world',
      aud: [client.id, 'EVE Online'],
      name: PILOT.name,
      owner: PILOT.owner,
      exp: now + 1200,
      iat: now,
      iss: 'https://login.eveonline.com',
    });
    const signature = sign('sha256', Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url');
    return `${head}.${body}.${signature}`;
  };

  const tokens = (res, scopes) => {
    const refreshToken = randomBytes(12).toString('hex');
    refresh.set(refreshToken, scopes);
    json(res, {
      access_token: jwt(scopes),
      token_type: 'Bearer',
      expires_in: 1199,
      refresh_token: refreshToken,
    });
  };

  const server = createServer(
    { cert: readFileSync(certFile), key: readFileSync(keyFile) },
    async (req, res) => {
      const url = new URL(req.url, `https://${req.headers.host}`);
      const host = (req.headers.host ?? '').split(':')[0];
      calls.push(`${req.method} ${host}${url.pathname}`);
      const body = req.method === 'POST' ? await readBody(req) : '';

      if (host === 'login.eveonline.com') {
        if (url.pathname === '/.well-known/oauth-authorization-server')
          return json(res, {
            issuer: 'https://login.eveonline.com',
            token_endpoint: 'https://login.eveonline.com/v2/oauth/token',
            jwks_uri: 'https://login.eveonline.com/oauth/jwks',
          });
        if (url.pathname === '/oauth/jwks')
          return json(res, {
            keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256' }],
          });
        if (url.pathname === '/v2/oauth/authorize') {
          const p = url.searchParams;
          if (p.get('client_id') !== client.id || p.get('code_challenge_method') !== 'S256')
            return json(res, { error: 'invalid_request' }, 400);
          const code = randomBytes(12).toString('hex');
          codes.set(code, { challenge: p.get('code_challenge'), scopes: (p.get('scope') ?? '').split(' ') });
          const back = new URL(p.get('redirect_uri'));
          back.searchParams.set('code', code);
          back.searchParams.set('state', p.get('state') ?? '');
          res.writeHead(302, { location: back.toString() });
          return res.end();
        }
        if (url.pathname === '/v2/oauth/token' && req.method === 'POST') {
          const basic = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`;
          if (req.headers.authorization !== basic) return json(res, { error: 'invalid_client' }, 401);
          const form = new URLSearchParams(body);
          if (form.get('grant_type') === 'authorization_code') {
            const pending = codes.get(form.get('code') ?? '');
            codes.delete(form.get('code') ?? '');
            const verifier = form.get('code_verifier') ?? '';
            if (!pending || createHash('sha256').update(verifier).digest('base64url') !== pending.challenge)
              return json(res, { error: 'invalid_grant' }, 400);
            return tokens(res, pending.scopes);
          }
          if (form.get('grant_type') === 'refresh_token') {
            const scopes = refresh.get(form.get('refresh_token') ?? '');
            refresh.delete(form.get('refresh_token') ?? '');
            return scopes ? tokens(res, scopes) : json(res, { error: 'invalid_grant' }, 400);
          }
        }
        return json(res, { error: 'not found' }, 404);
      }

      // esi.evetech.net
      if (url.pathname === '/characters/affiliation' && req.method === 'POST') {
        const ids = JSON.parse(body);
        return json(
          res,
          ids.includes(PILOT.id)
            ? [{ character_id: PILOT.id, corporation_id: PILOT.corporationId, alliance_id: 99000001 }]
            : [],
        );
      }
      const search = /^\/characters\/(\d+)\/search$/.exec(url.pathname);
      if (search) {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}');
        if (claims.sub !== `CHARACTER:EVE:${search[1]}` || !claims.scp?.includes(SEARCH_SCOPE))
          return json(res, { error: `token is not valid for scope(s): ${SEARCH_SCOPE}` }, 403);
        const category = url.searchParams.get('categories') ?? '';
        const text = (url.searchParams.get('search') ?? '').toLowerCase();
        if (text.length < 3) return json(res, { error: 'search must be at least 3 characters' }, 400);
        const ids = [...ENTITIES]
          .filter(([, e]) => e.category === category && e.name.toLowerCase().includes(text))
          .map(([id]) => id);
        return json(res, ids.length > 0 ? { [category]: ids } : {});
      }
      if (url.pathname === '/universe/names' && req.method === 'POST') {
        const ids = JSON.parse(body);
        if (ids.some((id) => !ENTITIES.has(id)))
          return json(res, { error: 'Ensure all IDs are valid before resolving.' }, 404);
        return json(
          res,
          ids.map((id) => ({ id, name: ENTITIES.get(id).name, category: ENTITIES.get(id).category })),
        );
      }
      if (url.pathname === '/universe/ids' && req.method === 'POST') {
        const names = JSON.parse(body).map((n) => n.toLowerCase());
        const out = {};
        for (const [id, e] of ENTITIES)
          if (names.includes(e.name.toLowerCase())) (out[`${e.category}s`] ??= []).push({ id, name: e.name });
        return json(res, out);
      }
      const detail = /^\/(corporations|alliances)\/(\d+)$/.exec(url.pathname);
      if (detail) {
        const e = ENTITIES.get(Number(detail[2]));
        return e && `${e.category}s` === detail[1]
          ? json(res, { name: e.name, ticker: e.ticker })
          : json(res, { error: 'not found' }, 404);
      }
      const character = /^\/characters\/(\d+)$/.exec(url.pathname);
      if (character && Number(character[1]) === PILOT.id)
        return json(res, { name: PILOT.name, corporation_id: PILOT.corporationId, security_status: 1.2 });
      return json(res, { error: 'not found' }, 404);
    },
  );
  return new Promise((resolve) =>
    server.listen(port, '0.0.0.0', () => resolve({ calls, close: () => server.close() })),
  );
}
