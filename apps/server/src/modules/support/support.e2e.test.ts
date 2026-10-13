import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AdminSupportFeedbackDto,
  AdminSupportInboxDto,
  AdminSupportThreadDto,
  MeDto,
  SupportClientDto,
  SupportSessionDto,
  SupportThreadDto,
  SupportTicketGroupDto,
} from '@darkbeacon/shared';
import { EVE_CLIENT, FakeNetwork, type EveCharacter } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { tempDir } from '../../plugins/packages.test-support.js';
import { Browser } from '../../test-support/browser.js';
import { FakePostHogSupport } from '../../test-support/fake-posthog-support.js';

const HUB = 'http://dbk.test';
const PILOT: EveCharacter = { id: 2112000001, name: 'Pilot One', owner: 'owner-a', corporationId: 98000001 };
const ALT: EveCharacter = { id: 2112000003, name: 'Pilot Alt', owner: 'owner-a', corporationId: 98000001 };
const STRANGER: EveCharacter = {
  id: 2112000002,
  name: 'Someone Else',
  owner: 'owner-c',
  corporationId: 98000002,
};
/** Where the hub's page sends a signed-out pilot from another instance's popup. */
const BACK = `/support?kind=ticket&origin=${encodeURIComponent('https://map.example.com')}`;

describeEachDialect('support hub over HTTP', (t) => {
  let app: NestFastifyApplication | undefined;
  let base: string;
  let network: FakeNetwork;
  let posthog: FakePostHogSupport | undefined;

  const start = async (env: Record<string, string>) => {
    network = new FakeNetwork();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const config = {
      ...parseEnv({
        NODE_ENV: 'test',
        PUBLIC_URL: HUB,
        DEMO_MODE: 'true',
        EVE_CLIENT_ID: EVE_CLIENT.clientId,
        EVE_CLIENT_SECRET: EVE_CLIENT.clientSecret,
        DATA_DIR: tempDir('dbk-support-'),
      }),
      secretKey: 's'.repeat(32),
    };
    // EVE SSO is the fake network; PostHog (when used) a real server on loopback.
    const fetchFn = (url: string, init?: RequestInit) =>
      url.startsWith('http://127.0.0.1') ? fetch(url, init) : network.fetch(url, init);
    app = await createApp(config, { database: t.db, logger: false, fetch: fetchFn });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await posthog?.stop();
    posthog = undefined;
    vi.unstubAllEnvs();
  });

  /**
   * Signs in to the hub the way any instance is signed in to: the app's EVE sign-in, back on the
   * support page the popup came from. The session is the app's own cookie.
   */
  const appSignIn = async (character: EveCharacter, browser = new Browser(base)) => {
    const back = await browser.oauth(`/api/auth/eve/signin?returnTo=${encodeURIComponent(BACK)}`, (c) =>
      network.approveEve(character, c),
    );
    expect(back).toBe(BACK);
    expect(browser.cookies.get('dbk_session')).toBeTruthy();
    return browser;
  };

  /** Links another character to the signed-in account (the app's link-character flow). */
  const link = (browser: Browser, character: EveCharacter) =>
    browser.oauth('/api/auth/eve/login?returnTo=%2Fsupport', (c) => network.approveEve(character, c));

  const owner = async () => {
    const browser = new Browser(base);
    await browser.json('/api/auth/dev', {
      method: 'POST',
      json: { name: 'Hub Owner', character: { name: 'Owner Main' } },
    });
    return browser;
  };

  const groups = (browser: Browser) => browser.json<SupportTicketGroupDto[]>('/api/support/tickets');

  it('signs pilots in with the app’s own session and sends them back to the support page only', async () => {
    await start({ SUPPORT_HUB: 'on', SUPPORT_BACKEND: 'local' });
    await owner();

    // Signed out: the page says so, and nothing of a pilot's answers.
    const anonymous = new Browser(base);
    expect(await anonymous.json<SupportSessionDto>('/api/support/session')).toEqual({
      available: true,
      backend: 'local',
      feedback: true,
      signedIn: false,
      characters: [],
    });
    for (const path of ['/api/support/tickets', '/api/support/handles'])
      expect((await anonymous.request(path)).status, path).toBe(401);
    expect(
      (
        await anonymous.request('/api/support/tickets', {
          method: 'POST',
          json: { category: 'bug', message: 'x' },
        })
      ).status,
    ).toBe(401);
    expect(await anonymous.json('/api/support/unread')).toEqual({ unread: 0 });
    // The separate sign-in is gone.
    for (const path of ['/api/support/auth/login', '/api/support/auth/callback'])
      expect((await anonymous.request(path)).status, path).toBe(404);

    // The app's sign-in comes back to the support page, with the popup's query.
    const pilot = await appSignIn(PILOT);
    expect(pilot.cookies.has('dbk_support')).toBe(false);
    expect(await pilot.json<SupportSessionDto>('/api/support/session')).toMatchObject({
      signedIn: true,
      characters: [{ id: PILOT.id, name: PILOT.name, main: true }],
    });
    // It is the app session: the same cookie opens the app.
    expect((await pilot.json<MeDto>('/api/accounts/me')).account.mainCharacterId).toBe(PILOT.id);

    // returnTo is a path on this site, never another one.
    for (const evil of [
      'https://evil.example/support',
      '//evil.example/support',
      '/\\evil.example/support',
      '/\t/evil.example',
      'javascript:alert(1)',
    ])
      expect(
        await new Browser(base).oauth(`/api/auth/eve/signin?returnTo=${encodeURIComponent(evil)}`, (c) =>
          network.approveEve(PILOT, c),
        ),
        evil,
      ).toBe('/');

    // Signing out of the app signs out of the hub.
    expect((await pilot.request('/api/auth/logout', { method: 'POST' })).status).toBe(204);
    expect((await pilot.request('/api/support/tickets')).status).toBe(401);
    expect((await pilot.json<SupportSessionDto>('/api/support/session')).signedIn).toBe(false);
  });

  it('runs the local desk end to end: characters, tickets, the admin inbox, unread handles', async () => {
    await start({ SUPPORT_HUB: 'on', SUPPORT_BACKEND: 'local' });
    const admin = await owner();
    const pilot = await appSignIn(PILOT);
    await link(pilot, ALT);
    const stranger = await appSignIn(STRANGER);

    // Every character of the account, main first.
    expect((await pilot.json<SupportSessionDto>('/api/support/session')).characters).toEqual([
      { id: PILOT.id, name: PILOT.name, main: true },
      { id: ALT.id, name: ALT.name, main: false },
    ]);

    const body = {
      category: 'bug',
      message: 'Signatures vanish after paste',
      context: {
        appVersion: '0.1.0',
        page: 'map',
        errors: ['TypeError: x of "J100101" at https://a.test/m/home'],
      },
    };
    const post = (browser: Browser, path: string, json?: unknown, origin = HUB) =>
      browser.request(path, { method: 'POST', ...(json === undefined ? {} : { json }), headers: { origin } });

    // CSRF: the session cookie counts only from the hub's own pages.
    expect((await post(pilot, '/api/support/tickets', body, 'https://evil.example')).status).toBe(401);
    expect(
      (await post(pilot, '/api/support/handles', { origin: 'https://evil.example' }, 'https://evil.example'))
        .status,
    ).toBe(401);
    expect(await pilot.json('/api/support/unread', { headers: { origin: 'https://evil.example' } })).toEqual({
      unread: 0,
    });
    // Context fields outside the list are refused.
    expect((await post(pilot, '/api/support/tickets', { ...body, context: { slug: 'home' } })).status).toBe(
      400,
    );
    // A character of another account, or none at all, is refused.
    for (const characterId of [STRANGER.id, 2112999999])
      expect(
        (await post(pilot, '/api/support/tickets', { ...body, characterId })).status,
        String(characterId),
      ).toBe(403);

    // The main character by default, another one when picked.
    const created = await post(pilot, '/api/support/tickets', body);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const onAlt = await post(pilot, '/api/support/tickets', {
      ...body,
      characterId: ALT.id,
      message: 'On the alt',
    });
    expect(onAlt.status).toBe(201);
    const { id: altId } = (await onAlt.json()) as { id: string };

    // My tickets: per character, main first.
    const mine = await groups(pilot);
    expect(mine.map((g) => [g.character, g.tickets.map((x) => x.id)])).toEqual([
      [{ id: PILOT.id, name: PILOT.name }, [id]],
      [{ id: ALT.id, name: ALT.name }, [altId]],
    ]);
    expect(mine[0]!.tickets).toMatchObject([{ id, number: 1, category: 'bug', status: 'new', unread: 0 }]);
    // A thread opens as the character it belongs to.
    expect((await pilot.request(`/api/support/tickets/${altId}/messages`)).status).toBe(404);
    expect(
      (await pilot.json<SupportThreadDto>(`/api/support/tickets/${altId}/messages?character=${ALT.id}`))
        .messages,
    ).toMatchObject([{ author: 'you', body: 'On the alt' }]);
    expect((await pilot.request(`/api/support/tickets/${id}/messages?character=${STRANGER.id}`)).status).toBe(
      403,
    );
    expect((await pilot.request(`/api/support/tickets/${id}/messages?character=nope`)).status).toBe(400);
    // Someone else's account sees none of it.
    expect(await groups(stranger)).toEqual([
      { character: { id: STRANGER.id, name: STRANGER.name }, tickets: [] },
    ]);
    expect((await stranger.request(`/api/support/tickets/${id}/messages`)).status).toBe(404);
    expect((await stranger.request(`/api/support/tickets/${id}/messages?character=${PILOT.id}`)).status).toBe(
      403,
    );

    // The admin inbox: the ticket, its (scrubbed) context, an answer and a status.
    const inbox = await admin.json<AdminSupportInboxDto>('/api/admin/support/tickets');
    expect(inbox.unanswered).toBe(2);
    expect(inbox.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, unread: 1, character: { id: PILOT.id, name: 'Pilot One' } }),
      ]),
    );
    const detail = await admin.json<AdminSupportThreadDto>(`/api/admin/support/tickets/${id}`);
    expect(detail.context.errors).toEqual(['TypeError: x of <str> at <url>']);
    expect((await pilot.request(`/api/admin/support/tickets/${id}`)).status).toBe(403);
    for (const [ticket, message] of [
      [id, 'Fixed in 0.1.1, please update'],
      [altId, 'And on the alt'],
    ] as const) {
      const answered = await admin.json<AdminSupportThreadDto>(
        `/api/admin/support/tickets/${ticket}/messages`,
        {
          method: 'POST',
          json: { message },
        },
      );
      expect(answered.ticket.status).toBe('pending');
    }
    await admin.json(`/api/admin/support/tickets/${id}`, { method: 'PATCH', json: { priority: 'high' } });

    // The pilot sees the answers as unread, over every character, on the hub and through a handle.
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 2 });
    const handleAnswer = await post(pilot, '/api/support/handles', { origin: 'https://map.example.com' });
    expect(handleAnswer.status).toBe(201);
    const { handle } = (await handleAnswer.json()) as { handle: string };

    const anonymous = new Browser(base);
    const polled = await anonymous.request(`/api/support/unread?h=${handle}`, {
      headers: { origin: 'https://map.example.com' },
    });
    expect(polled.status).toBe(200);
    expect(polled.headers.get('access-control-allow-origin')).toBe('https://map.example.com');
    expect(polled.headers.get('access-control-allow-credentials')).toBeNull();
    expect(await polled.json()).toEqual({ unread: 2 });
    expect(
      (
        await anonymous.request(`/api/support/unread?h=${handle}`, {
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect((await anonymous.request(`/api/support/unread?h=dbsh_${'x'.repeat(43)}`)).status).toBe(404);
    expect((await anonymous.request('/api/support/unread?h=garbage')).status).toBe(400);

    const thread = await pilot.json<SupportThreadDto>(`/api/support/tickets/${id}/messages`);
    expect(thread.messages.map((m) => [m.author, m.authorName, m.body])).toEqual([
      ['you', null, 'Signatures vanish after paste'],
      ['support', 'Darkbeacon support', 'Fixed in 0.1.1, please update'],
    ]);
    expect((await post(pilot, `/api/support/tickets/${id}/read`)).status).toBe(204);
    expect((await post(pilot, `/api/support/tickets/${altId}/read?character=${ALT.id}`)).status).toBe(204);
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 0 });
    // Read and reply from another origin: refused like any change.
    expect(
      (await post(pilot, `/api/support/tickets/${id}/messages`, { message: 'x' }, 'https://evil.example'))
        .status,
    ).toBe(401);
    const replied = await post(pilot, `/api/support/tickets/${id}/messages`, {
      message: 'Works now, thanks',
    });
    expect(replied.status).toBe(200);

    // Handles belong to the account: listed and revoked by it, not by someone else.
    const handles = await pilot.json<Array<{ id: string; origin: string }>>('/api/support/handles');
    expect(handles).toMatchObject([{ origin: 'https://map.example.com' }]);
    expect(await stranger.json('/api/support/handles')).toEqual([]);
    expect(
      (
        await stranger.request(`/api/support/handles/${handles[0]!.id}`, {
          method: 'DELETE',
          headers: { origin: HUB },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await pilot.request(`/api/support/handles/${handles[0]!.id}`, {
          method: 'DELETE',
          headers: { origin: HUB },
        })
      ).status,
    ).toBe(204);
    expect((await anonymous.request(`/api/support/unread?h=${handle}`)).status).toBe(404);

    // The main character is sold: the buyer signs in with it under a new EVE owner and starts clean.
    const buyer = await appSignIn({ ...PILOT, owner: 'owner-b' });
    expect(await groups(buyer)).toEqual([{ character: { id: PILOT.id, name: PILOT.name }, tickets: [] }]);
    expect((await buyer.request(`/api/support/tickets/${id}/messages`)).status).toBe(404);
    expect((await post(buyer, `/api/support/tickets/${id}/messages`, { message: 'mine?' })).status).toBe(404);
    // The seller no longer holds it: only the alt's tickets are left, the main one is refused.
    expect((await groups(pilot)).map((g) => g.character.id)).toEqual([ALT.id]);
    expect((await pilot.request(`/api/support/tickets/${id}/messages?character=${PILOT.id}`)).status).toBe(
      403,
    );
    // Bought back by the first owner: their tickets again.
    await link(pilot, PILOT);
    expect((await groups(pilot)).find((g) => g.character.id === PILOT.id)?.tickets.map((x) => x.id)).toEqual([
      id,
    ]);

    // Five new tickets an hour per character; the other character is not held up.
    for (let i = 0; i < 4; i++)
      expect((await post(pilot, '/api/support/tickets', { ...body, characterId: PILOT.id })).status).toBe(
        201,
      );
    expect((await post(pilot, '/api/support/tickets', { ...body, characterId: PILOT.id })).status).toBe(429);
    expect((await post(pilot, '/api/support/tickets', { ...body, characterId: ALT.id })).status).toBe(201);

    // An account without an EVE character (Discord) is asked to link one.
    const discord = new Browser(base);
    await discord.json('/api/auth/dev', { method: 'POST', json: { name: 'Discord Only' } });
    expect(await discord.json<SupportSessionDto>('/api/support/session')).toMatchObject({
      signedIn: true,
      characters: [],
    });
    expect(await groups(discord)).toEqual([]);
    const refused = await post(discord, '/api/support/tickets', body);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      'Link an EVE character to your account first',
    );

    // Feedback: anonymous from the hub's page, never from elsewhere; signed in as the main character.
    expect(
      (await post(anonymous, '/api/support/feedback', { kind: 'quick', rating: 5, text: 'Love it' })).status,
    ).toBe(202);
    expect(
      (
        await anonymous.request('/api/support/feedback', {
          method: 'POST',
          json: { kind: 'quick', rating: 5 },
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(anonymous, '/api/support/feedback', { kind: 'quick', rating: 5 }, 'https://evil.example'))
        .status,
    ).toBe(403);
    expect((await post(pilot, '/api/support/feedback', { kind: 'feature', text: 'Dark mode' })).status).toBe(
      202,
    );
    const feedback = await admin.json<AdminSupportFeedbackDto[]>('/api/admin/support/feedback');
    expect(feedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'quick', rating: 5, text: 'Love it', character: null }),
        expect.objectContaining({
          kind: 'feature',
          text: 'Dark mode',
          character: { id: PILOT.id, name: PILOT.name },
        }),
      ]),
    );

    // Audited without content.
    const audit = await admin.json<{ entries: Array<{ type: string }> }>('/api/admin/audit');
    const types = audit.entries.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['support.ticket_created', 'support.replied', 'support.ticket_updated']),
    );
    expect(JSON.stringify(audit)).not.toContain('Signatures vanish');
    expect(JSON.stringify(audit)).not.toContain('Fixed in 0.1.1');

    // The webhook is off without a secret.
    expect(
      (await anonymous.request('/api/support/webhook', { method: 'POST', json: { distinct_id: 'eve:1' } }))
        .status,
    ).toBe(404);

    // This instance is the hub: the help menu opens it in the app.
    expect(await admin.json<SupportClientDto>('/api/support/client')).toMatchObject({
      hubUrl: HUB,
      inApp: true,
      localInbox: true,
      handle: null,
    });
  });

  it('runs on PostHog Support, with feedback as survey answers and replies announced by the webhook', async () => {
    posthog = new FakePostHogSupport({ token: 'tok', secret: 'sec', allowedDomains: ['dbk.test'] });
    const host = await posthog.start();
    await start({
      SUPPORT_HUB: 'on',
      SUPPORT_POSTHOG_HOST: host,
      SUPPORT_PUBLIC_TOKEN: 'tok',
      SUPPORT_SECRET_KEY: 'sec',
      SUPPORT_SURVEYS_KEY: 'phc_support',
      SUPPORT_SURVEY_QUICK: 'sq:q-rate:q-text',
      SUPPORT_WEBHOOK_SECRET: 'w'.repeat(32),
    });
    const anonymous = new Browser(base);
    expect(await anonymous.json<SupportSessionDto>('/api/support/session')).toMatchObject({
      available: true,
      backend: 'posthog',
      feedback: true,
    });
    const pilot = await appSignIn(PILOT);
    const created = await pilot.request('/api/support/tickets', {
      method: 'POST',
      json: { category: 'question', message: 'How do I import from Wanderer?', context: { page: 'import' } },
      headers: { origin: HUB },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(posthog.tickets.get(id)).toMatchObject({
      distinctId: `eve:${PILOT.id}`,
      traits: { name: 'Pilot One' },
      sessionContext: { category: 'question', page: 'import' },
    });
    // The category comes from the hub's own note.
    expect((await groups(pilot))[0]!.tickets).toMatchObject([{ id, category: 'question', unread: 0 }]);

    posthog.answer(id, 'Admin > Import, paste the Wanderer URL');
    // Cached: the hub does not know yet...
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 0 });
    // ...until PostHog's workflow tells it.
    expect(
      (
        await anonymous.request('/api/support/webhook', {
          method: 'POST',
          json: { distinct_id: `eve:${PILOT.id}` },
          headers: { 'x-support-webhook-secret': 'wrong' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await anonymous.request('/api/support/webhook', {
          method: 'POST',
          json: { distinct_id: `eve:${PILOT.id}` },
          headers: { 'x-support-webhook-secret': 'w'.repeat(32) },
        })
      ).status,
    ).toBe(204);
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 1 });
    const thread = await pilot.json<SupportThreadDto>(`/api/support/tickets/${id}/messages`);
    expect(thread.messages.at(-1)).toMatchObject({ author: 'support', authorName: 'Zan' });

    // A new owner of the character is a new person in PostHog.
    const buyer = await appSignIn({ ...PILOT, owner: 'owner-b' });
    const bought = await buyer.request('/api/support/tickets', {
      method: 'POST',
      json: { category: 'bug', message: 'New owner here' },
      headers: { origin: HUB },
    });
    expect(bought.status).toBe(201);
    const { id: boughtId } = (await bought.json()) as { id: string };
    expect(posthog.tickets.get(boughtId)).toMatchObject({ distinctId: `eve:${PILOT.id}:o2` });

    // Feedback goes to the surveys project; feature requests are not set up here.
    const sent = await anonymous.request('/api/support/feedback', {
      method: 'POST',
      json: { kind: 'quick', rating: 4, text: 'Good', context: { appVersion: '0.1.0' } },
      headers: { origin: HUB },
    });
    expect(sent.status).toBe(202);
    expect(posthog.captured).toMatchObject([
      {
        event: 'survey sent',
        properties: { $survey_id: 'sq', '$survey_response_q-rate': '4', $process_person_profile: false },
      },
    ]);
    expect(
      (
        await anonymous.request('/api/support/feedback', {
          method: 'POST',
          json: { kind: 'feature', text: 'x' },
          headers: { origin: HUB },
        })
      ).status,
    ).toBe(503);
    // No inbox: PostHog is where staff answer.
    expect((await (await owner()).request('/api/admin/support/tickets')).status).toBe(404);
  });

  it('is off on an ordinary instance, which only points its help menu at the hub', async () => {
    await start({ SUPPORT_HUB_URL: 'https://hub.example' });
    const anonymous = new Browser(base);
    expect(await anonymous.json<SupportSessionDto>('/api/support/session')).toMatchObject({
      available: false,
      signedIn: false,
    });
    expect((await anonymous.request('/api/support/tickets')).status).toBe(404);
    expect((await anonymous.request(`/api/support/unread?h=dbsh_${'a'.repeat(43)}`)).status).toBe(404);

    const account = await owner();
    expect((await account.request('/api/support/tickets')).status).toBe(404);
    expect(await account.json<SupportClientDto>('/api/support/client')).toMatchObject({
      hubUrl: 'https://hub.example',
      inApp: false,
      handle: null,
      localInbox: false,
      instance: { db: t.db.dialect, loginMethod: 'eve', demo: true },
    });
    const handle = `dbsh_${'h'.repeat(43)}`;
    expect(
      (
        await account.request('/api/support/handle', {
          method: 'PUT',
          json: { hubOrigin: 'https://other.example', handle },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await account.request('/api/support/handle', {
          method: 'PUT',
          json: { hubOrigin: 'https://hub.example', handle },
        })
      ).status,
    ).toBe(204);
    expect((await account.json<SupportClientDto>('/api/support/client')).handle).toBe(handle);
    expect((await anonymous.json<SupportClientDto>('/api/support/client')).handle).toBeNull();
    expect((await account.request('/api/support/handle', { method: 'DELETE' })).status).toBe(204);
    expect((await account.json<SupportClientDto>('/api/support/client')).handle).toBeNull();
  });

  it('can be turned off on any instance', async () => {
    await start({ SUPPORT_HUB_URL: 'off' });
    expect(await new Browser(base).json<SupportClientDto>('/api/support/client')).toMatchObject({
      hubUrl: null,
    });
  });
});
