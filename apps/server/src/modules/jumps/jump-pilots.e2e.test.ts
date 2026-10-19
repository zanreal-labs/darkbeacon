import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { JumpPilotDto, MeDto } from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DISCORD_CLIENT, EVE_CLIENT, FakeNetwork } from '../../adapters/identity/fake-network.js';
import type { FetchLike } from '../../adapters/identity/oauth-http.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';

const SKILLS_SCOPE = 'esi-skills.read_skills.v1';
const FATIGUE_SCOPE = 'esi-characters.read_fatigue.v1';
const PILOT = { id: 2112000001, name: 'Alice Pilot', owner: 'h1', corporationId: 98000001 };

/** One of my characters' jump skills and fatigue from ESI, over HTTP. */
describeEachDialect('jump pilots over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  let network: FakeNetwork;
  /** ESI calls for skills and fatigue, by path. */
  let asked: string[];
  let fatigueExpires: string | undefined;

  /** ESI's skills and fatigue for the token's own character, when the token carries the scope. */
  const esi: FetchLike = async (url, init = {}) => {
    const u = new URL(url);
    const route = /^\/characters\/(\d+)\/(skills|fatigue)$/.exec(u.pathname);
    if (u.host !== 'esi.evetech.net' || !route) return network.fetch(url, init);
    asked.push(u.pathname);
    const token = (new Headers(init.headers).get('authorization') ?? '').replace(/^Bearer /, '');
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as {
      scp?: string[];
      sub?: string;
    };
    const scope = route[2] === 'skills' ? SKILLS_SCOPE : FATIGUE_SCOPE;
    if (claims.sub !== `CHARACTER:EVE:${route[1]}` || !claims.scp?.includes(scope))
      return Response.json({ error: 'token not valid for scope' }, { status: 403 });
    return Response.json(
      route[2] === 'skills'
        ? {
            skills: [
              { skill_id: 21611, active_skill_level: 5, trained_skill_level: 5, skillpoints_in_skill: 1 },
              { skill_id: 21610, active_skill_level: 3, trained_skill_level: 4, skillpoints_in_skill: 1 },
            ],
            total_sp: 2,
          }
        : fatigueExpires
          ? { jump_fatigue_expire_date: fatigueExpires }
          : {},
    );
  };

  beforeEach(async () => {
    network = new FakeNetwork();
    asked = [];
    fatigueExpires = undefined;
    const config = {
      ...parseEnv({
        NODE_ENV: 'test',
        PUBLIC_URL: 'http://ww.test',
        DISCORD_CLIENT_ID: DISCORD_CLIENT.clientId,
        DISCORD_CLIENT_SECRET: DISCORD_CLIENT.clientSecret,
        EVE_CLIENT_ID: EVE_CLIENT.clientId,
        EVE_CLIENT_SECRET: EVE_CLIENT.clientSecret,
      }),
      secretKey: 's'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false, fetch: esi });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const signIn = async (discordId: string, name: string) => {
    const browser = new Browser(base);
    await browser.oauth('/api/auth/discord/login', (challenge) =>
      network.approveDiscord({ id: discordId, username: name }, challenge),
    );
    return browser;
  };

  it('asks for skills and fatigue with the jumps extra, and names what a grant lacks', async () => {
    const alice = await signIn('1001', 'alice');
    const begin = await alice.request('/api/auth/eve/login?extras=jumps');
    const scopes = new URL(begin.headers.get('location')!).searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual(expect.arrayContaining([SKILLS_SCOPE, FATIGUE_SCOPE]));

    // Linked without the extra: nothing is read, and the planner can say what to allow.
    await alice.oauth('/api/auth/eve/login', (challenge) => network.approveEve(PILOT, challenge));
    const without = await alice.json<JumpPilotDto>(`/api/jumps/pilots/${PILOT.id}`);
    expect(without).toMatchObject({
      characterId: PILOT.id,
      skills: null,
      fatigueMinutes: null,
      fatigueExpiresAt: null,
      missingScopes: [SKILLS_SCOPE, FATIGUE_SCOPE],
      problem: null,
    });
    expect(asked).toEqual([]);
    expect((await alice.json<MeDto>('/api/accounts/me')).characters[0]?.extras).toEqual([]);
  });

  it('fills skills and fatigue from ESI for my own character only', async () => {
    network.eveScopes = [...network.eveScopes, SKILLS_SCOPE, FATIGUE_SCOPE];
    fatigueExpires = new Date(Date.now() + 90 * 60_000).toISOString();
    const alice = await signIn('1001', 'alice');
    await alice.oauth('/api/auth/eve/login?extras=jumps', (challenge) =>
      network.approveEve(PILOT, challenge),
    );
    expect((await alice.json<MeDto>('/api/accounts/me')).characters[0]?.extras).toEqual(['jumps']);

    const pilot = await alice.json<JumpPilotDto>(`/api/jumps/pilots/${PILOT.id}`);
    expect(pilot).toMatchObject({
      skills: { jdc: 5, jfc: 3, jf: 0 },
      fatigueExpiresAt: Date.parse(fatigueExpires),
      missingScopes: [],
      problem: null,
    });
    expect(pilot.fatigueMinutes).toBeGreaterThanOrEqual(89);
    expect(pilot.fatigueMinutes).toBeLessThanOrEqual(90);
    expect(asked).toEqual([`/characters/${PILOT.id}/skills`, `/characters/${PILOT.id}/fatigue`]);

    // Asked again at once: ESI's answers are kept for as long as ESI caches them.
    await alice.json<JumpPilotDto>(`/api/jumps/pilots/${PILOT.id}`);
    expect(asked).toHaveLength(2);

    const bob = await signIn('1002', 'bob');
    expect((await bob.request(`/api/jumps/pilots/${PILOT.id}`)).status).toBe(404);
    expect((await new Browser(base).request(`/api/jumps/pilots/${PILOT.id}`)).status).toBe(401);
    expect((await alice.request('/api/jumps/pilots/nope')).status).toBe(400);
  });
});
