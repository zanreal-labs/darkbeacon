import { describe, expect, it } from 'vitest';
import { AUDIT_STREAM } from '@darkbeacon/core';
import { SUPPORT_LIMITS } from '../domain/limits.js';
import { hubFixture } from './fakes.test-support.js';

const PILOT = { characterId: 2112000001, characterName: 'Pilot One', ownerHash: 'owner-a' };
const OTHER = { characterId: 2112000002, characterName: 'Pilot Two', ownerHash: 'owner-b' };
const ticket = (message = 'The map does not load') => ({
  category: 'bug' as const,
  message,
  context: { appVersion: '0.1.0', errors: ['TypeError at "J123456" 31000005 https://x.test/m/home'] },
});

describe('support hub', () => {
  it('opens tickets for the signed-in identity only, with the category noted and an audit record', async () => {
    const { hub, desk, events, notes } = hubFixture();
    const me = await hub.signIn(PILOT);
    const other = await hub.signIn(OTHER);
    const { id } = await hub.create(me, ticket());

    // The context's error lines were scrubbed again before reaching the desk.
    expect(desk.tickets.get(id)?.context.errors).toEqual(['TypeError at <str> <n> <url>']);
    expect(notes.notes.get(id)).toBe('bug');
    expect((await hub.tickets(me)).map((t) => [t.id, t.category])).toEqual([[id, 'bug']]);
    expect(await hub.tickets(other)).toEqual([]);
    await expect(hub.thread(other, id)).rejects.toThrow(/not found/);
    await expect(hub.reply(other, id, 'mine now')).rejects.toThrow(/not found/);
    await expect(hub.markRead(other, id)).rejects.toThrow(/not found/);

    expect(events.appended).toHaveLength(1);
    expect(events.appended[0]).toMatchObject({
      stream: AUDIT_STREAM,
      type: 'support.ticket_created',
      data: { ticketId: id, category: 'bug', backend: 'posthog', characterId: PILOT.characterId },
    });
    // Never the message or the context on the audit.
    expect(JSON.stringify(events.appended[0])).not.toContain('does not load');
  });

  it('gives a new owner of a character a fresh identity', async () => {
    const { hub } = hubFixture();
    const seller = await hub.signIn(PILOT);
    await hub.create(seller, ticket('seller ticket'));
    const buyer = await hub.signIn({ ...PILOT, ownerHash: 'owner-new' });
    expect(buyer.distinctId).toBe(`eve:${PILOT.characterId}:o2`);
    expect(await hub.tickets(buyer)).toEqual([]);
    expect(await hub.tickets(seller)).toHaveLength(1);
  });

  it('refuses ids that are not ticket ids before asking the desk', async () => {
    const { hub, desk } = hubFixture();
    const me = await hub.signIn(PILOT);
    for (const bad of ['../tickets', '1', "x' or 1=1"]) {
      await expect(hub.thread(me, bad)).rejects.toThrow(/not found/);
      await expect(hub.reply(me, bad, 'hi')).rejects.toThrow(/not found/);
    }
    expect(desk.calls.thread).toBe(0);
  });

  it('caches lists and threads, and drops them on the identity’s own changes and on a webhook', async () => {
    const { hub, desk } = hubFixture();
    const me = await hub.signIn(PILOT);
    const { id } = await hub.create(me, ticket());
    await hub.tickets(me);
    await hub.tickets(me);
    expect(desk.calls.list).toBe(1);
    expect(await hub.unread(me)).toBe(0);
    expect(desk.calls.list).toBe(1);

    // Staff answer in PostHog: the hub learns it from the webhook (or after the cache lapses).
    desk.answer(id, 'Fixed in 0.1.1');
    expect(await hub.unread(me)).toBe(0);
    hub.replyPosted(me.distinctId);
    expect(await hub.unread(me)).toBe(1);

    const thread = await hub.thread(me, id);
    expect(thread.messages.map((m) => [m.author, m.authorName])).toEqual([
      ['you', null],
      ['support', 'Zan'],
    ]);
    await hub.markRead(me, id);
    expect(await hub.unread(me)).toBe(0);
    const replied = await hub.reply(me, id, 'Thanks!');
    expect(replied.messages.at(-1)).toMatchObject({ author: 'you', body: 'Thanks!' });
  });

  it('limits new tickets per character', async () => {
    const { hub } = hubFixture();
    const me = await hub.signIn(PILOT);
    for (let i = 0; i < SUPPORT_LIMITS.tickets.limit; i++) await hub.create(me, ticket(`t${i}`));
    await expect(hub.create(me, ticket('one too many'))).rejects.toMatchObject({ code: 'rate_limited' });
    // Another pilot is not held up.
    await expect(hub.create(await hub.signIn(OTHER), ticket())).resolves.toHaveProperty('id');
  });

  it('sends feedback anonymously unless signed in, and refuses when it has nowhere to go', async () => {
    const { hub, feedback } = hubFixture();
    const me = await hub.signIn(PILOT);
    await hub.feedback(null, { kind: 'quick', rating: 5, text: '', context: {} }, '203.0.113.9');
    await hub.feedback(
      me,
      { kind: 'feature', text: 'Dark mode for the jump planner', context: { page: 'jump' } },
      null,
    );
    expect(feedback.sent.map((f) => [f.kind, f.identity?.distinctId ?? null])).toEqual([
      ['quick', null],
      ['feature', me.distinctId],
    ]);
    for (let i = 1; i < SUPPORT_LIMITS.feedback.limit; i++)
      await hub.feedback(null, { kind: 'quick', rating: 3, text: '', context: {} }, '203.0.113.9');
    await expect(
      hub.feedback(null, { kind: 'quick', rating: 3, text: '', context: {} }, '203.0.113.9'),
    ).rejects.toMatchObject({ code: 'rate_limited' });

    const none = hubFixture({ feedback: null });
    await expect(
      none.hub.feedback(null, { kind: 'quick', rating: 1, text: '', context: {} }, null),
    ).rejects.toThrow(/not found/);
  });

  describe('unread handles', () => {
    it('answer only the count, only for the instance they were made for, until revoked', async () => {
      const { hub, desk, handles } = hubFixture();
      const me = await hub.signIn(PILOT);
      const { id } = await hub.create(me, ticket());
      desk.answer(id, 'Hello');
      hub.replyPosted(me.distinctId);

      const handle = await hub.createHandle(me, 'https://map.example.com');
      expect(handle).toMatch(/^dbsh_[A-Za-z0-9_-]{43}$/);
      // Only a hash is kept.
      expect(handles.rows[0]!.tokenHash).toBe(`h(${handle})`);
      expect(JSON.stringify(handles.rows)).not.toContain(`"${handle}"`);

      expect(await hub.unreadForHandle(handle, 'https://map.example.com')).toBe(1);
      expect(await hub.unreadForHandle(handle, null)).toBe(1);
      await expect(hub.unreadForHandle(handle, 'https://evil.example')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(hub.unreadForHandle(`dbsh_${'B'.repeat(43)}`, null)).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(hub.unreadForHandle('nonsense', null)).rejects.toMatchObject({ code: 'not_found' });

      const [listed] = await hub.handles(me);
      expect(listed).toMatchObject({ origin: 'https://map.example.com' });
      expect(listed!.lastUsedAt).not.toBeNull();
      await expect(hub.revokeHandle(await hub.signIn(OTHER), listed!.id)).rejects.toMatchObject({
        code: 'not_found',
      });
      await hub.revokeHandle(me, listed!.id);
      await expect(hub.unreadForHandle(handle, null)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('keep one per instance and a few in all, and are only made for https origins', async () => {
      const { hub } = hubFixture();
      const me = await hub.signIn(PILOT);
      await expect(hub.createHandle(me, 'http://map.example.com')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(hub.createHandle(me, 'https://map.example.com/path')).rejects.toMatchObject({
        code: 'forbidden',
      });
      const first = await hub.createHandle(me, 'https://a.example');
      await hub.createHandle(me, 'https://a.example');
      await expect(hub.unreadForHandle(first, null)).rejects.toMatchObject({ code: 'not_found' });
      expect(await hub.handles(me)).toHaveLength(1);
    });

    it('are rate-limited per handle', async () => {
      const { hub } = hubFixture();
      const me = await hub.signIn(PILOT);
      const handle = await hub.createHandle(me, 'https://a.example');
      for (let i = 0; i < SUPPORT_LIMITS.unread.limit; i++) await hub.unreadForHandle(handle, null);
      await expect(hub.unreadForHandle(handle, null)).rejects.toMatchObject({ code: 'rate_limited' });
    });
  });
});
