import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SupportIdentity } from '@darkbeacon/support';
import { FakePostHogSupport } from '../../test-support/fake-posthog-support.js';
import { identityHash, PostHogSupportDesk, widgetSessionId } from './posthog-support-desk.js';
import { PostHogSurveys } from './posthog-surveys.js';

const SECRET = 'phs_test_secret';
const TOKEN = 'widget-public-token';
const HUB = 'https://darkbeacon.zanreal.app';
const ME: SupportIdentity = {
  distinctId: 'eve:2112000001',
  characterId: 2112000001,
  characterName: 'Pilot One',
};
const BUYER: SupportIdentity = {
  distinctId: 'eve:2112000001:o2',
  characterId: 2112000001,
  characterName: 'Pilot One',
};

describe('PostHog identity verification', () => {
  it('signs the distinct id as PostHog verifies it: HMAC-SHA256 with the secret, lowercase hex', () => {
    // Reference values from Python: hmac.new(secret, distinct_id, sha256).hexdigest(), which is
    // PostHog's compute_identity_hash.
    expect(identityHash('eve:2112000001', SECRET)).toBe(
      '7e1e4e1da97c53b78b4b4cba523e5321119aa54cd9005d846a3c1c3e096eb24a',
    );
    expect(identityHash('eve:2112000001:o2', SECRET)).toBe(
      'ee83588de3b4b7ce853caeed4147d8c5e85911e5afee8e1458d94ec5962e3c2a',
    );
  });

  it('gives every identity its own stable widget session (a UUID)', () => {
    const a = widgetSessionId(ME.distinctId, SECRET);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(widgetSessionId(ME.distinctId, SECRET)).toBe(a);
    expect(widgetSessionId(BUYER.distinctId, SECRET)).not.toBe(a);
  });
});

describe('PostHog Support desk against a widget API double', () => {
  let posthog: FakePostHogSupport;
  let desk: PostHogSupportDesk;

  beforeEach(async () => {
    posthog = new FakePostHogSupport({
      token: TOKEN,
      secret: SECRET,
      allowedDomains: ['darkbeacon.zanreal.app'],
    });
    const host = await posthog.start();
    desk = new PostHogSupportDesk({
      host,
      publicToken: TOKEN,
      secretKey: SECRET,
      origin: HUB,
      fetch: (url, init) => fetch(url, init),
      userAgent: 'darkbeacon-hub/test',
    });
  });

  afterEach(() => posthog.stop());

  it('opens, lists, reads and answers tickets as posthog-js does', async () => {
    const { id } = await desk.createTicket(ME, {
      category: 'bug',
      message: 'Signatures vanish after paste',
      context: {
        appVersion: '0.1.0',
        page: 'map',
        errors: ['TypeError <str>'],
        instanceHost: 'map.example.com',
      },
    });
    const create = posthog.requests[0]!;
    expect(create.method).toBe('POST');
    expect(create.path).toBe('/message');
    expect(create.headers['x-conversations-token']).toBe(TOKEN);
    expect(create.headers.origin).toBe(HUB);
    expect(create.body).toMatchObject({
      message: 'Signatures vanish after paste',
      ticket_id: null,
      identity_distinct_id: ME.distinctId,
      identity_hash: identityHash(ME.distinctId, SECRET),
      widget_session_id: widgetSessionId(ME.distinctId, SECRET),
      distinct_id: ME.distinctId,
      traits: { name: 'Pilot One' },
      session_context: {
        category: 'bug',
        app_version: '0.1.0',
        page: 'map',
        errors: 'TypeError <str>',
        instance_host: 'map.example.com',
      },
    });
    // Never the secret, never an email.
    expect(JSON.stringify(posthog.requests)).not.toContain(SECRET);
    expect(create.body?.traits).not.toHaveProperty('email');

    expect(await desk.listTickets(ME)).toMatchObject([
      { id, number: 1, status: 'new', unread: 0, preview: 'Signatures vanish after paste', messageCount: 1 },
    ]);
    const list = posthog.requests[1]!;
    expect(list.method).toBe('GET');
    expect(list.path).toBe('/tickets');
    expect(list.query).toMatchObject({ identity_distinct_id: ME.distinctId, limit: '100', offset: '0' });

    posthog.answer(id, 'Fixed in 0.1.1');
    const thread = await desk.thread(ME, id);
    expect(thread?.ticket).toMatchObject({ status: 'pending', unread: 1 });
    expect(thread?.messages.map((m) => [m.author, m.authorName, m.body])).toEqual([
      ['customer', null, 'Signatures vanish after paste'],
      ['support', 'Zan', 'Fixed in 0.1.1'],
    ]);

    expect(await desk.markRead(ME, id)).toBe(true);
    const read = posthog.requests.at(-1)!;
    expect(read).toMatchObject({ method: 'POST', path: `/messages/${id}/read` });
    expect(read.body).toMatchObject({ identity_distinct_id: ME.distinctId });
    expect((await desk.listTickets(ME))[0]!.unread).toBe(0);

    expect(await desk.reply(ME, id, 'Thanks')).toBe(true);
    expect(posthog.tickets.get(id)!.messages).toHaveLength(3);
  });

  it('keeps every identity to its own tickets (a buyer never sees the seller’s)', async () => {
    const { id } = await desk.createTicket(ME, { category: 'question', message: 'seller', context: {} });
    expect(await desk.listTickets(BUYER)).toEqual([]);
    expect(await desk.thread(BUYER, id)).toBeNull();
    expect(await desk.reply(BUYER, id, 'hijack')).toBe(false);
    expect(await desk.markRead(BUYER, id)).toBe(false);
  });

  it('turns PostHog failures into errors the hub can show', async () => {
    const wrongSecret = new PostHogSupportDesk({
      host: posthog.host,
      publicToken: TOKEN,
      secretKey: 'not-the-secret',
      origin: HUB,
      fetch: (url, init) => fetch(url, init),
      userAgent: 't',
    });
    await expect(wrongSecret.listTickets(ME)).rejects.toMatchObject({ status: 503 });
    const elsewhere = new PostHogSupportDesk({
      host: posthog.host,
      publicToken: TOKEN,
      secretKey: SECRET,
      origin: 'https://not-allowed.example',
      fetch: (url, init) => fetch(url, init),
      userAgent: 't',
    });
    await expect(
      elsewhere.createTicket(ME, { category: 'bug', message: 'x', context: {} }),
    ).rejects.toMatchObject({
      status: 503,
    });
    const down = new PostHogSupportDesk({
      host: 'http://127.0.0.1:9',
      publicToken: TOKEN,
      secretKey: SECRET,
      origin: HUB,
      fetch: (url, init) => fetch(url, init),
      userAgent: 't',
    });
    await expect(down.listTickets(ME)).rejects.toMatchObject({ status: 503 });
  });

  it('spreads PostHog’s burst limit per identity, not per hub address', async () => {
    await posthog.stop();
    posthog = new FakePostHogSupport({ token: TOKEN, secret: SECRET, burst: 3 });
    const host = await posthog.start();
    desk = new PostHogSupportDesk({
      host,
      publicToken: TOKEN,
      secretKey: SECRET,
      origin: HUB,
      fetch,
      userAgent: 't',
    });
    for (let i = 0; i < 3; i++) await desk.listTickets(ME);
    await expect(desk.listTickets(ME)).rejects.toMatchObject({ code: 'rate_limited' });
    // Another pilot from the same server still gets through.
    await expect(desk.listTickets(BUYER)).resolves.toEqual([]);
  });

  it('sends feedback as a survey answer, anonymous without a person profile', async () => {
    const surveys = new PostHogSurveys({
      host: posthog.host,
      projectKey: 'phc_support',
      surveys: {
        quick: { surveyId: 'sq', ratingQuestionId: 'q-rate', textQuestionId: 'q-text' },
        feature: { surveyId: 'sf', ratingQuestionId: null, textQuestionId: 'q-idea' },
      },
      fetch: (url, init) => fetch(url, init),
      userAgent: 't',
    });
    await surveys.send({
      id: '0e7c2f0a-1111-4222-8333-444455556666',
      kind: 'quick',
      rating: 4,
      text: 'Nice',
      identity: null,
      context: { appVersion: '0.1.0', page: 'map' },
      at: Date.UTC(2026, 9, 13),
    });
    await surveys.send({
      id: '0e7c2f0a-1111-4222-8333-444455556667',
      kind: 'feature',
      rating: null,
      text: 'Wormhole effects overlay',
      identity: ME,
      context: {},
      at: Date.UTC(2026, 9, 13),
    });
    const [anonymous, signed] = posthog.captured;
    expect(anonymous).toMatchObject({
      api_key: 'phc_support',
      event: 'survey sent',
      distinct_id: '0e7c2f0a-1111-4222-8333-444455556666',
      properties: {
        $survey_id: 'sq',
        '$survey_response_q-rate': '4',
        '$survey_response_q-text': 'Nice',
        $survey_completed: true,
        $process_person_profile: false,
        $geoip_disable: true,
        app_version: '0.1.0',
        page: 'map',
      },
    });
    expect(signed).toMatchObject({
      distinct_id: ME.distinctId,
      properties: {
        $survey_id: 'sf',
        '$survey_response_q-idea': 'Wormhole effects overlay',
        $set: { name: 'Pilot One' },
      },
    });
    expect(signed!.properties).not.toHaveProperty('$process_person_profile');
  });
});
