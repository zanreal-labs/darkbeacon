import type { Clock } from '@darkbeacon/core';
import type { FuelMarket } from '@darkbeacon/jumps';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

const ESI = 'https://esi.evetech.net';

/** Never kept longer than this, even when ESI's `Expires` lies further ahead. */
const MAX_TTL_MS = 15 * 60_000;
/** At most this many pages of one type's sell orders in one region (isotopes fit on one). */
const MAX_PAGES = 5;

/**
 * The lowest sell order of a type at a station, from ESI's public market orders
 * (`GET /markets/{region_id}/orders?type_id=&order_type=sell`, paged by `X-Pages`). Each answer is
 * kept until ESI's `Expires` (at most 15 minutes), since ESI's cache gives the same until then.
 */
export class EsiFuelMarket implements FuelMarket {
  private readonly cache = new Map<string, { until: number; value: number | null }>();

  constructor(
    private readonly options: { clock: Clock; userAgent: string; fetch?: typeof fetch; baseUrl?: string },
  ) {}

  async lowestSell(regionId: number, stationId: number, typeId: number): Promise<number | null> {
    const key = `${regionId}:${stationId}:${typeId}`;
    const now = this.options.clock.now();
    const cached = this.cache.get(key);
    if (cached && cached.until > now) return cached.value;
    let lowest: number | null = null;
    let expires = Number.NaN;
    for (let page = 1, pages = 1; page <= Math.min(pages, MAX_PAGES); page++) {
      const url = `${this.options.baseUrl ?? ESI}/markets/${regionId}/orders?type_id=${typeId}&order_type=sell&page=${page}`;
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          'x-compatibility-date': ESI_COMPATIBILITY_DATE,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`ESI answered ${response.status}`);
      pages = Number(response.headers.get('x-pages')) || 1;
      if (page === 1) expires = Date.parse(response.headers.get('expires') ?? '');
      const orders = (await response.json()) as Array<{
        location_id: number;
        price: number;
        is_buy_order?: boolean;
      }>;
      for (const order of orders) {
        if (order.location_id !== stationId || order.is_buy_order) continue;
        if (lowest === null || order.price < lowest) lowest = order.price;
      }
    }
    const until = Number.isFinite(expires)
      ? Math.min(Math.max(expires, now + 1000), now + MAX_TTL_MS)
      : now + MAX_TTL_MS;
    this.cache.set(key, { until, value: lowest });
    return lowest;
  }
}
