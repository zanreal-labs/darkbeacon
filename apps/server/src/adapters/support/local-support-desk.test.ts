import { expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { SupportIdentity } from '@darkbeacon/support';
import { SecretBox } from '../identity/secret-box.js';
import {
  KyselyClientHandles,
  KyselySupportHandles,
  KyselySupportIdentities,
  KyselyTicketNotes,
} from './kysely-support-stores.js';
import { LocalSupportDesk } from './local-support-desk.js';

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

describeEachDialect('the hub’s own support store', (t) => {
  it('keeps tickets per identity, numbers them, and tracks unread both ways', async () => {
    const clock = new ManualClock();
    const desk = new LocalSupportDesk(t.db, clock);
    const first = await desk.createTicket(ME, {
      category: 'bug',
      message: 'Map does not load',
      context: { appVersion: '0.1.0', errors: ['TypeError <str>'] },
    });
    clock.advance(1000);
    const second = await desk.createTicket(ME, {
      category: 'question',
      message: 'How do I import?',
      context: {},
    });

    const mine = await desk.listTickets(ME);
    expect(mine.map((x) => [x.number, x.category, x.status])).toEqual([
      [2, 'question', 'new'],
      [1, 'bug', 'new'],
    ]);
    expect(await desk.listTickets(BUYER)).toEqual([]);
    expect(await desk.thread(BUYER, first.id)).toBeNull();
    expect(await desk.reply(BUYER, first.id, 'x')).toBe(false);
    expect(await desk.markRead(BUYER, first.id)).toBe(false);

    // The inbox sees both, with the team's unread count and the context.
    const inbox = await desk.list('active');
    expect(inbox.map((x) => [x.number, x.unread, x.priority, x.characterName])).toEqual([
      [2, 1, 'medium', 'Pilot One'],
      [1, 1, 'medium', 'Pilot One'],
    ]);
    expect((await desk.get(first.id))?.context).toEqual({ appVersion: '0.1.0', errors: ['TypeError <str>'] });

    clock.advance(1000);
    expect(await desk.answer(first.id, 'Fixed in 0.1.1', 'Darkbeacon support')).toBe(true);
    const thread = await desk.thread(ME, first.id);
    expect(thread?.ticket).toMatchObject({
      status: 'pending',
      unread: 1,
      messageCount: 2,
      preview: 'Fixed in 0.1.1',
    });
    expect(thread?.messages.map((m) => [m.author, m.authorName])).toEqual([
      ['customer', null],
      ['support', 'Darkbeacon support'],
    ]);
    expect(await desk.markRead(ME, first.id)).toBe(true);
    expect((await desk.thread(ME, first.id))?.ticket.unread).toBe(0);

    // The pilot writes again: open, and unread for the team.
    expect(await desk.reply(ME, first.id, 'Still broken')).toBe(true);
    expect((await desk.get(first.id))?.ticket).toMatchObject({ status: 'open', unread: 1 });

    expect(await desk.update(first.id, { status: 'resolved', priority: 'high' })).toMatchObject({
      status: 'resolved',
      priority: 'high',
    });
    expect((await desk.list('active')).map((x) => x.id)).toEqual([second.id]);
    expect((await desk.list('resolved')).map((x) => x.id)).toEqual([first.id]);
    expect(await desk.ownerOf(first.id)).toBe(ME.distinctId);
    expect(await desk.answer('0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11', 'x', null)).toBe(false);
  });

  it('numbers tickets opened at the same time without gaps or clashes', async () => {
    const desk = new LocalSupportDesk(t.db, new ManualClock());
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        desk.createTicket(ME, { category: 'bug', message: `t${i}`, context: {} }),
      ),
    );
    expect((await desk.listTickets(ME)).map((x) => x.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps feedback, anonymous or with the character', async () => {
    const desk = new LocalSupportDesk(t.db, new ManualClock());
    await desk.send({ id: 'f1', kind: 'quick', rating: 5, text: '', identity: null, context: {}, at: 1 });
    await desk.send({
      id: 'f2',
      kind: 'feature',
      rating: null,
      text: 'Idea',
      identity: ME,
      context: { page: 'map' },
      at: 2,
    });
    expect(await desk.feedback(10)).toEqual([
      {
        id: 'f2',
        kind: 'feature',
        rating: null,
        text: 'Idea',
        characterId: ME.characterId,
        characterName: 'Pilot One',
        createdAt: 2,
      },
      { id: 'f1', kind: 'quick', rating: 5, text: '', characterId: null, characterName: null, createdAt: 1 },
    ]);
  });

  it('remembers owners, ticket notes and handles', async () => {
    const identities = new KyselySupportIdentities(t.db);
    await identities.save({ characterId: 2112000001, ownerHash: 'a', generation: 1, characterName: 'P' }, 1);
    await identities.save({ characterId: 2112000001, ownerHash: 'b', generation: 2, characterName: 'P' }, 2);
    await identities.save(
      { characterId: 2112000001, ownerHash: 'a', generation: 1, characterName: 'Renamed' },
      3,
    );
    expect((await identities.ofCharacter(2112000001)).sort((x, y) => x.generation - y.generation)).toEqual([
      { characterId: 2112000001, ownerHash: 'a', generation: 1, characterName: 'Renamed' },
      { characterId: 2112000001, ownerHash: 'b', generation: 2, characterName: 'P' },
    ]);

    const notes = new KyselyTicketNotes(t.db);
    await notes.save('t1', { distinctId: ME.distinctId, category: 'support', createdAt: 1 });
    expect(await notes.categories(['t1', 't2'])).toEqual(new Map([['t1', 'support']]));
    expect(await notes.categories([])).toEqual(new Map());

    const handles = new KyselySupportHandles(t.db);
    await handles.create({
      id: 'h1',
      tokenHash: 'hash1',
      accountId: 'account-me',
      origin: 'https://a.example',
      createdAt: 1,
      lastUsedAt: null,
    });
    expect(await handles.byTokenHash('hash1')).toMatchObject({ id: 'h1', origin: 'https://a.example' });
    await handles.touch('h1', 5);
    expect((await handles.ofAccount('account-me'))[0]?.lastUsedAt).toBe(5);
    expect(await handles.ofAccount('account-other')).toEqual([]);
    expect(await handles.revoke('account-other', 'h1')).toBe(false);
    expect(await handles.revoke('account-me', 'h1')).toBe(true);
    expect(await handles.byTokenHash('hash1')).toBeNull();

    const box = new SecretBox('k'.repeat(32), 'support-handle');
    const client = new KyselyClientHandles(t.db, box);
    const handle = `dbsh_${'a'.repeat(43)}`;
    await client.set('acc1', { hubOrigin: 'https://hub.example', handle }, 1);
    expect(await client.get('acc1')).toEqual({ hubOrigin: 'https://hub.example', handle });
    // Sealed at rest.
    const raw = await t.db
      .db<{ support_client_handles: { handle: string } }>()
      .selectFrom('support_client_handles')
      .select('handle')
      .executeTakeFirst();
    expect(raw?.handle).not.toContain(handle);
    await client.clear('acc1');
    expect(await client.get('acc1')).toBeNull();
  });
});
