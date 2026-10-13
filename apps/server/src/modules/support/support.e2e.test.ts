import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AdminSupportFeedbackDto,
  AdminSupportInboxDto,
  AdminSupportThreadDto,
  SupportClientDto,
  SupportSessionDto,
  SupportThreadDto,
  SupportTicketDto,
} from '@darkbeacon/shared';
import { EVE_CLIENT, FakeNetwork, type EveCharacter } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { tempDir } from '../../plugins/packages.test-support.js';
import { Browser } from '../../test-support/browser.js';
import { FakePostHogSupport } from '../../test-support/fake-posthog-support.js';

const HUB = 'http://dbk.test';
const PILOT: EveCharacter = { id: 2112000001, name: 'Pilot One', owner: 'owner-a', corporationId: 98000001 };

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

  /** Signs in on the hub with EVE SSO (no scopes) and returns the browser and its CSRF token. */
  const hubSignIn = async (character: EveCharacter, browser = new Browser(base)) => {
    const begin = await browser.request('/support/login?returnTo=%2Fsupport%3Fkind%3Dticket');
    expect(begin.status).toBe(302);
    const sso = new URL(begin.headers.get('location')!);
    expect(sso.host).toBe('login.eveonline.com');
    expect(sso.searchParams.has('scope')).toBe(false);
    expect(sso.searchParams.get('redirect_uri')).toBe(`${HUB}/support/callback`);
    const code = network.approveEve(character, sso.searchParams.get('code_challenge'));
    const back = await browser.request(
      `/support/callback?code=${code}&state=${sso.searchParams.get('state')}`,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/support?kind=ticket');
    const session = await browser.json<SupportSessionDto>('/api/support/session');
    expect(session.character).toEqual({ id: character.id, name: character.name });
    return { browser, csrf: session.csrf! };
  };

  const write = (csrf: string, origin = HUB) => ({ origin, 'x-support-csrf': csrf });

  const owner = async () => {
    const browser = new Browser(base);
    await browser.json('/api/auth/dev', {
      method: 'POST',
      json: { name: 'Hub Owner', character: { name: 'Owner Main' } },
    });
    return browser;
  };

  it('runs the local desk end to end: sign-in, tickets, the admin inbox, unread handles', async () => {
    await start({ SUPPORT_HUB: 'on', SUPPORT_BACKEND: 'local' });
    const admin = await owner();

    expect(await new Browser(base).json<SupportSessionDto>('/api/support/session')).toEqual({
      available: true,
      backend: 'local',
      feedback: true,
      character: null,
      csrf: null,
    });
    // Anonymous: no tickets.
    expect((await new Browser(base).request('/api/support/tickets')).status).toBe(401);

    const { browser: pilot, csrf } = await hubSignIn(PILOT);
    const cookie = pilot.cookies.get('dbk_support');
    expect(cookie).toBeTruthy();
    // The hub session is not an app session.
    expect((await pilot.request('/api/accounts/me')).status).toBe(401);

    const body = {
      category: 'bug',
      message: 'Signatures vanish after paste',
      context: {
        appVersion: '0.1.0',
        page: 'map',
        errors: ['TypeError: x of "J100101" at https://a.test/m/home'],
      },
    };
    // CSRF: no token, a wrong token, another origin, no origin.
    expect(
      (await pilot.request('/api/support/tickets', { method: 'POST', json: body, headers: { origin: HUB } }))
        .status,
    ).toBe(403);
    expect(
      (await pilot.request('/api/support/tickets', { method: 'POST', json: body, headers: write('nope') }))
        .status,
    ).toBe(403);
    expect(
      (
        await pilot.request('/api/support/tickets', {
          method: 'POST',
          json: body,
          headers: write(csrf, 'https://evil.example'),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await pilot.request('/api/support/tickets', {
          method: 'POST',
          json: body,
          headers: { 'x-support-csrf': csrf },
        })
      ).status,
    ).toBe(403);
    // Context fields outside the list are refused.
    expect(
      (
        await pilot.request('/api/support/tickets', {
          method: 'POST',
          json: { ...body, context: { slug: 'home' } },
          headers: write(csrf),
        })
      ).status,
    ).toBe(400);

    const created = await pilot.request('/api/support/tickets', {
      method: 'POST',
      json: body,
      headers: write(csrf),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const mine = await pilot.json<SupportTicketDto[]>('/api/support/tickets');
    expect(mine).toMatchObject([{ id, number: 1, category: 'bug', status: 'new', unread: 0 }]);

    // The admin inbox: the ticket, its (scrubbed) context, an answer and a status.
    const inbox = await admin.json<AdminSupportInboxDto>('/api/admin/support/tickets');
    expect(inbox).toMatchObject({
      unanswered: 1,
      tickets: [{ id, unread: 1, character: { name: 'Pilot One' } }],
    });
    const detail = await admin.json<AdminSupportThreadDto>(`/api/admin/support/tickets/${id}`);
    expect(detail.context.errors).toEqual(['TypeError: x of <str> at <url>']);
    expect((await pilot.request(`/api/admin/support/tickets/${id}`)).status).toBe(401);
    const answered = await admin.json<AdminSupportThreadDto>(`/api/admin/support/tickets/${id}/messages`, {
      method: 'POST',
      json: { message: 'Fixed in 0.1.1, please update' },
    });
    expect(answered.ticket.status).toBe('pending');
    await admin.json(`/api/admin/support/tickets/${id}`, { method: 'PATCH', json: { priority: 'high' } });

    // The pilot sees the answer as unread, on the hub and through a handle.
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 1 });
    const handleAnswer = await pilot.request('/api/support/handles', {
      method: 'POST',
      json: { origin: 'https://map.example.com' },
      headers: write(csrf),
    });
    expect(handleAnswer.status).toBe(201);
    const { handle } = (await handleAnswer.json()) as { handle: string };

    const anonymous = new Browser(base);
    const polled = await anonymous.request(`/api/support/unread?h=${handle}`, {
      headers: { origin: 'https://map.example.com' },
    });
    expect(polled.status).toBe(200);
    expect(polled.headers.get('access-control-allow-origin')).toBe('https://map.example.com');
    expect(polled.headers.get('access-control-allow-credentials')).toBeNull();
    expect(await polled.json()).toEqual({ unread: 1 });
    expect(
      (
        await anonymous.request(`/api/support/unread?h=${handle}`, {
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect((await anonymous.request(`/api/support/unread?h=dbsh_${'x'.repeat(43)}`)).status).toBe(404);
    expect((await anonymous.request('/api/support/unread?h=garbage')).status).toBe(400);
    // Another origin cannot read the pilot's count with their cookie.
    expect(
      await (
        await pilot.request('/api/support/unread', { headers: { origin: 'https://evil.example' } })
      ).json(),
    ).toEqual({ unread: 0 });

    const thread = await pilot.json<SupportThreadDto>(`/api/support/tickets/${id}/messages`);
    expect(thread.messages.map((m) => [m.author, m.authorName, m.body])).toEqual([
      ['you', null, 'Signatures vanish after paste'],
      ['support', 'Darkbeacon support', 'Fixed in 0.1.1, please update'],
    ]);
    expect(
      (await pilot.request(`/api/support/tickets/${id}/read`, { method: 'POST', headers: write(csrf) }))
        .status,
    ).toBe(204);
    expect(await pilot.json('/api/support/unread')).toEqual({ unread: 0 });
    const replied = await pilot.request(`/api/support/tickets/${id}/messages`, {
      method: 'POST',
      json: { message: 'Works now, thanks' },
      headers: write(csrf),
    });
    expect(replied.status).toBe(200);

    // Handles can be listed and revoked.
    const handles = await pilot.json<Array<{ id: string; origin: string }>>('/api/support/handles');
    expect(handles).toMatchObject([{ origin: 'https://map.example.com' }]);
    expect(
      (
        await pilot.request(`/api/support/handles/${handles[0]!.id}`, {
          method: 'DELETE',
          headers: write(csrf),
        })
      ).status,
    ).toBe(204);
    expect((await anonymous.request(`/api/support/unread?h=${handle}`)).status).toBe(404);

    // The character changes hands: the buyer starts clean and cannot reach the seller's ticket.
    const { browser: buyer, csrf: buyerCsrf } = await hubSignIn({ ...PILOT, owner: 'owner-b' });
    expect(await buyer.json('/api/support/tickets')).toEqual([]);
    expect((await buyer.request(`/api/support/tickets/${id}/messages`)).status).toBe(404);
    expect(
      (
        await buyer.request(`/api/support/tickets/${id}/messages`, {
          method: 'POST',
          json: { message: 'mine?' },
          headers: write(buyerCsrf),
        })
      ).status,
    ).toBe(404);
    // ...and the seller, signing in again, still has it.
    const { browser: seller } = await hubSignIn(PILOT);
    expect(await seller.json<SupportTicketDto[]>('/api/support/tickets')).toHaveLength(1);

    // Five new tickets an hour per character.
    for (let i = 0; i < 4; i++)
      expect(
        (await pilot.request('/api/support/tickets', { method: 'POST', json: body, headers: write(csrf) }))
          .status,
      ).toBe(201);
    const limited = await pilot.request('/api/support/tickets', {
      method: 'POST',
      json: body,
      headers: write(csrf),
    });
    expect(limited.status).toBe(429);

    // Feedback: anonymous from the hub's page, never from elsewhere.
    expect(
      (
        await anonymous.request('/api/support/feedback', {
          method: 'POST',
          json: { kind: 'quick', rating: 5, text: 'Love it' },
          headers: { origin: HUB },
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await anonymous.request('/api/support/feedback', {
          method: 'POST',
          json: { kind: 'quick', rating: 5 },
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    const feedback = await admin.json<AdminSupportFeedbackDto[]>('/api/admin/support/feedback');
    expect(feedback).toMatchObject([{ kind: 'quick', rating: 5, text: 'Love it', character: null }]);

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

    // Signing out ends the hub session.
    expect(
      (await pilot.request('/api/support/auth/logout', { method: 'POST', headers: { origin: HUB } })).status,
    ).toBe(204);
    expect((await pilot.request('/api/support/tickets')).status).toBe(401);
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
    const { browser: pilot, csrf } = await hubSignIn(PILOT);
    const created = await pilot.request('/api/support/tickets', {
      method: 'POST',
      json: { category: 'question', message: 'How do I import from Wanderer?', context: { page: 'import' } },
      headers: write(csrf),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(posthog.tickets.get(id)).toMatchObject({
      distinctId: `eve:${PILOT.id}`,
      traits: { name: 'Pilot One' },
      sessionContext: { category: 'question', page: 'import' },
    });
    // The category comes from the hub's own note.
    expect(await pilot.json<SupportTicketDto[]>('/api/support/tickets')).toMatchObject([
      { id, category: 'question', unread: 0 },
    ]);

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
    });
    expect((await anonymous.request('/support/login')).headers.get('location')).toMatch(
      /^\/support\?support_error=/,
    );
    expect((await anonymous.request('/api/support/tickets')).status).toBe(404);
    expect((await anonymous.request(`/api/support/unread?h=dbsh_${'a'.repeat(43)}`)).status).toBe(404);

    const account = await owner();
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
