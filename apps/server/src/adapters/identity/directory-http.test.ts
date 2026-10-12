import { describe, expect, it } from 'vitest';
import { EsiUnavailableError } from '@darkbeacon/identity';
import { DiscordBotHttp } from './discord-bot-http.js';
import { EsiDirectoryHttp } from './esi-directory-http.js';
import type { FetchLike } from './oauth-http.js';

const clock = (start = 1_000_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('EsiDirectoryHttp', () => {
  it('searches one category with the compatibility date and the character token', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetchFn: FetchLike = (url, init) => {
      seen.push({ url, headers: new Headers(init?.headers) });
      return Promise.resolve(answer({ corporation: [1, 2] }));
    };
    const esi = new EsiDirectoryHttp(clock(), fetchFn);
    expect(
      await esi.search({ characterId: 9, accessToken: 'tok', category: 'corporation', text: 'goon' }),
    ).toEqual([1, 2]);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe('/characters/9/search');
    expect(url.searchParams.getAll('categories')).toEqual(['corporation']);
    expect(url.searchParams.get('search')).toBe('goon');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(seen[0]!.headers.get('x-compatibility-date')).toBe('2020-01-01');
  });

  it('splits a /universe/names batch that has an unknown id', async () => {
    const known = new Map([
      [1, 'One'],
      [3, 'Three'],
    ]);
    const fetchFn: FetchLike = (_url, init) => {
      const ids = JSON.parse(String(init?.body)) as number[];
      if (ids.some((id) => !known.has(id)))
        return Promise.resolve(answer({ error: 'Ensure all IDs are valid' }, 404));
      return Promise.resolve(answer(ids.map((id) => ({ id, name: known.get(id), category: 'corporation' }))));
    };
    const esi = new EsiDirectoryHttp(clock(), fetchFn);
    expect(await esi.names([1, 2, 3])).toEqual([
      { id: 1, name: 'One', category: 'corporation' },
      { id: 3, name: 'Three', category: 'corporation' },
    ]);
  });

  it('rests after a 420 and before the error limit runs out', async () => {
    const time = clock();
    let next: Response = answer({}, 420, { 'retry-after': '30' });
    const esi = new EsiDirectoryHttp(time, () => Promise.resolve(next));
    await expect(esi.idsByName(['x'])).rejects.toBeInstanceOf(EsiUnavailableError);
    // No call is made while resting.
    next = answer({});
    await expect(esi.idsByName(['x'])).rejects.toBeInstanceOf(EsiUnavailableError);
    time.advance(31_000);
    next = answer({}, 200, { 'x-esi-error-limit-remain': '5', 'x-esi-error-limit-reset': '20' });
    expect(await esi.idsByName(['x'])).toEqual([]);
    await expect(esi.idsByName(['x'])).rejects.toMatchObject({ retryAt: time.now() + 20_000 });
  });
});

describe('DiscordBotHttp', () => {
  it('waits out a short 429 once and maps channel kinds and categories', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchFn: FetchLike = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(answer({ retry_after: 0.25, global: false }, 429));
      return Promise.resolve(
        answer([
          { id: '1', name: 'Ops', type: 4, position: 0 },
          { id: '2', name: 'alerts', type: 0, position: 1, parent_id: '1' },
          { id: '3', name: 'news', type: 5, position: 2 },
          { id: '4', name: 'voice', type: 2, position: 3 },
        ]),
      );
    };
    const bot = new DiscordBotHttp(fetchFn, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    expect(await bot.channels('token', '9')).toEqual([
      { id: '2', name: 'alerts', kind: 'text', category: 'Ops', position: 1 },
      { id: '3', name: 'news', kind: 'announcement', category: null, position: 2 },
    ]);
    expect(waits).toEqual([250]);
  });

  it('reports Discord refusals in words', async () => {
    const bot = new DiscordBotHttp(() =>
      Promise.resolve(answer({ message: 'Missing Permissions', code: 50013 }, 403)),
    );
    await expect(bot.send('token', '1', { content: 'x' })).rejects.toThrow(
      /Missing Permissions.*permissions/,
    );
    const unauthorized = new DiscordBotHttp(() => Promise.resolve(answer({ message: '401' }, 401)));
    await expect(unauthorized.me('token')).rejects.toMatchObject({ name: 'ExternalAuthError' });
  });
});
