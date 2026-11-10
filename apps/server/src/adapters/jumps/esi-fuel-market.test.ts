import { describe, expect, it } from 'vitest';
import { EsiFuelMarket } from './esi-fuel-market.js';

const JITA = 60003760;
const FORGE = 10000002;

function fakeEsi(pages: Array<Array<{ location_id: number; price: number }>>, expires?: string) {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(pages[page - 1] ?? []), {
      headers: { 'x-pages': String(pages.length), ...(expires ? { expires } : {}) },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe('EsiFuelMarket', () => {
  it('takes the lowest sell order at the station over every page, and keeps it until Expires', async () => {
    let now = Date.parse('2026-11-09T12:00:00Z');
    const { fetchFn, urls } = fakeEsi(
      [
        [
          { location_id: JITA, price: 620 },
          { location_id: 60000001, price: 500 },
        ],
        [{ location_id: JITA, price: 616 }],
      ],
      'Mon, 09 Nov 2026 12:05:00 GMT',
    );
    const market = new EsiFuelMarket({ clock: { now: () => now }, userAgent: 'test', fetch: fetchFn });
    expect(await market.lowestSell(FORGE, JITA, 17889)).toBe(616);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/markets/10000002/orders?type_id=17889&order_type=sell&page=1');
    now += 4 * 60_000;
    await market.lowestSell(FORGE, JITA, 17889);
    expect(urls).toHaveLength(2);
    now += 2 * 60_000;
    await market.lowestSell(FORGE, JITA, 17889);
    expect(urls).toHaveLength(4);
  });

  it('answers null when nobody sells at the station, and throws when ESI fails', async () => {
    const { fetchFn } = fakeEsi([[{ location_id: 60000001, price: 500 }]]);
    const market = new EsiFuelMarket({ clock: { now: () => 0 }, userAgent: 'test', fetch: fetchFn });
    expect(await market.lowestSell(FORGE, JITA, 16274)).toBeNull();
    const failing = new EsiFuelMarket({
      clock: { now: () => 0 },
      userAgent: 'test',
      fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    });
    await expect(failing.lowestSell(FORGE, JITA, 16274)).rejects.toThrow(/503/);
  });
});
