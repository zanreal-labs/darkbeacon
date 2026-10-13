import { describe, expect, it } from 'vitest';
import { AUDIT_STREAM } from '@darkbeacon/core';
import { SUPPORT_LIMITS } from '../domain/limits.js';
import { hubFixture } from './fakes.test-support.js';
import { SUPPORT_NEEDS_CHARACTER } from './hub.js';

const PILOT = { characterId: 2112000001, characterName: 'Pilot One', ownerHash: 'owner-a' };
const ALT = { characterId: 2112000003, characterName: 'Pilot Alt', ownerHash: 'owner-a' };
const OTHER = { characterId: 2112000002, characterName: 'Pilot Two', ownerHash: 'owner-b' };
const ME = 'account-me';
const THEM = 'account-them';
const ticket = (message = 'The map does not load') => ({
  category: 'bug' as const,
  message,
  context: { appVersion: '0.1.0', errors: ['TypeError at "J123456" 31000005 https://x.test/m/home'] },
});

/** A hub with my account (a main and an alt) and someone else's (one character). */
function fixture(over: Parameters<typeof hubFixture>[0] = {}) {
  const f = hubFixture(over);
  f.accounts.link(ME, ALT);
  f.accounts.link(ME, PILOT, true);
  f.accounts.link(THEM, OTHER);
  return f;
}

describe('support hub', () => {
  it('opens tickets for the signed-in identity only, with the category noted and an audit record', async () => {
    const { hub, desk, events, notes } = fixture();
    const me = await hub.identity(ME);
    const other = await hub.identity(THEM);
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

  describe('characters of the account', () => {
    it('uses the main character unless another of the account is picked', async () => {
      const { hub } = fixture();
      expect((await hub.characters(ME)).map((c) => [c.characterId, c.main])).toEqual([
        [PILOT.characterId, true],
        [ALT.characterId, false],
      ]);
      expect(await hub.identity(ME)).toEqual({
        distinctId: `eve:${PILOT.characterId}`,
        characterId: PILOT.characterId,
        characterName: 'Pilot One',
      });
      expect((await hub.identity(ME, ALT.characterId)).distinctId).toBe(`eve:${ALT.characterId}`);
    });

    it('refuses a character that is not linked to the account', async () => {
      const { hub } = fixture();
      await expect(hub.identity(ME, OTHER.characterId)).rejects.toMatchObject({
        code: 'forbidden',
        message: 'That character is not linked to your account',
      });
      await expect(hub.identity(ME, 999)).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('asks an account without characters (Discord only) to link one first', async () => {
      const { hub } = fixture();
      expect(await hub.characters('discord-only')).toEqual([]);
      await expect(hub.identity('discord-only')).rejects.toMatchObject({
        code: 'forbidden',
        message: SUPPORT_NEEDS_CHARACTER,
      });
      expect(await hub.ticketGroups('discord-only')).toEqual([]);
      expect(await hub.unreadOfAccount('discord-only')).toBe(0);
    });

    it('lists my tickets per character, main first', async () => {
      const { hub } = fixture();
      const main = await hub.create(await hub.identity(ME), ticket('on the main'));
      const alt = await hub.create(await hub.identity(ME, ALT.characterId), ticket('on the alt'));
      await hub.create(await hub.identity(THEM), ticket('not mine'));
      const groups = await hub.ticketGroups(ME);
      expect(groups.map((g) => [g.character, g.tickets.map((t) => t.id)])).toEqual([
        [{ id: PILOT.characterId, name: 'Pilot One' }, [main.id]],
        [{ id: ALT.characterId, name: 'Pilot Alt' }, [alt.id]],
      ]);
    });
  });

  it('gives a new owner of a character a fresh identity, from the owner hash the app keeps', async () => {
    const { hub, accounts, identities } = fixture();
    const seller = await hub.identity(ME);
    await hub.create(seller, ticket('seller ticket'));
    // Sold: the buyer links it to their own account with EVE SSO, under a new owner hash.
    accounts.link('account-buyer', { ...PILOT, ownerHash: 'owner-new' });
    const buyer = await hub.identity('account-buyer', PILOT.characterId);
    expect(buyer.distinctId).toBe(`eve:${PILOT.characterId}:o2`);
    expect(await hub.tickets(buyer)).toEqual([]);
    expect(await hub.tickets(seller)).toHaveLength(1);
    // The seller no longer holds it.
    await expect(hub.identity(ME, PILOT.characterId)).rejects.toMatchObject({ code: 'forbidden' });
    // Bought back: the first owner's tickets again.
    accounts.link(ME, PILOT, true);
    expect((await hub.identity(ME)).distinctId).toBe(`eve:${PILOT.characterId}`);
    expect(identities.records.filter((r) => r.characterId === PILOT.characterId)).toHaveLength(2);
  });

  it('refuses ids that are not ticket ids before asking the desk', async () => {
    const { hub, desk } = fixture();
    const me = await hub.identity(ME);
    for (const bad of ['../tickets', '1', "x' or 1=1"]) {
      await expect(hub.thread(me, bad)).rejects.toThrow(/not found/);
      await expect(hub.reply(me, bad, 'hi')).rejects.toThrow(/not found/);
    }
    expect(desk.calls.thread).toBe(0);
  });

  it('caches lists and threads, and drops them on the identity’s own changes and on a webhook', async () => {
    const { hub, desk } = fixture();
    const me = await hub.identity(ME);
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
    expect(await hub.unreadOfAccount(ME)).toBe(1);

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
    const { hub } = fixture();
    const me = await hub.identity(ME);
    for (let i = 0; i < SUPPORT_LIMITS.tickets.limit; i++) await hub.create(me, ticket(`t${i}`));
    await expect(hub.create(me, ticket('one too many'))).rejects.toMatchObject({ code: 'rate_limited' });
    // Another pilot is not held up.
    await expect(hub.create(await hub.identity(THEM), ticket())).resolves.toHaveProperty('id');
  });

  it('sends feedback anonymously unless signed in, and refuses when it has nowhere to go', async () => {
    const { hub, feedback } = fixture();
    const me = await hub.identity(ME);
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
    it('answer only the count of the whole account, only for the instance they were made for, until revoked', async () => {
      const { hub, desk, handles } = fixture();
      const main = await hub.identity(ME);
      const alt = await hub.identity(ME, ALT.characterId);
      const one = await hub.create(main, ticket());
      const two = await hub.create(alt, ticket('alt'));
      desk.answer(one.id, 'Hello');
      desk.answer(two.id, 'Hello alt');
      hub.replyPosted(main.distinctId);
      hub.replyPosted(alt.distinctId);

      const handle = await hub.createHandle(ME, 'https://map.example.com');
      expect(handle).toMatch(/^dbsh_[A-Za-z0-9_-]{43}$/);
      // Only a hash is kept.
      expect(handles.rows[0]!.tokenHash).toBe(`h(${handle})`);
      expect(JSON.stringify(handles.rows)).not.toContain(`"${handle}"`);

      expect(await hub.unreadForHandle(handle, 'https://map.example.com')).toBe(2);
      expect(await hub.unreadForHandle(handle, null)).toBe(2);
      await expect(hub.unreadForHandle(handle, 'https://evil.example')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(hub.unreadForHandle(`dbsh_${'B'.repeat(43)}`, null)).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(hub.unreadForHandle('nonsense', null)).rejects.toMatchObject({ code: 'not_found' });

      const [listed] = await hub.handles(ME);
      expect(listed).toMatchObject({ origin: 'https://map.example.com' });
      expect(listed!.lastUsedAt).not.toBeNull();
      await expect(hub.revokeHandle(THEM, listed!.id)).rejects.toMatchObject({ code: 'not_found' });
      await hub.revokeHandle(ME, listed!.id);
      await expect(hub.unreadForHandle(handle, null)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('keep one per instance and a few in all, and are only made for https origins', async () => {
      const { hub } = fixture();
      await expect(hub.createHandle(ME, 'http://map.example.com')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(hub.createHandle(ME, 'https://map.example.com/path')).rejects.toMatchObject({
        code: 'forbidden',
      });
      const first = await hub.createHandle(ME, 'https://a.example');
      await hub.createHandle(ME, 'https://a.example');
      await expect(hub.unreadForHandle(first, null)).rejects.toMatchObject({ code: 'not_found' });
      expect(await hub.handles(ME)).toHaveLength(1);
    });

    it('are rate-limited per handle', async () => {
      const { hub } = fixture();
      const handle = await hub.createHandle(ME, 'https://a.example');
      for (let i = 0; i < SUPPORT_LIMITS.unread.limit; i++) await hub.unreadForHandle(handle, null);
      await expect(hub.unreadForHandle(handle, null)).rejects.toMatchObject({ code: 'rate_limited' });
    });
  });
});
