import type { EveAffiliations, EveWallet } from '@darkbeacon/identity';
import type { FetchLike } from './oauth-http.js';

const ESI = 'https://esi.evetech.net';
/** Both routes are documented under this compatibility date (https://esi.evetech.net/meta/openapi.json). */
const COMPATIBILITY_DATE = '2020-01-01';
const BATCH = 1000;

/** Bulk affiliation and the wallet balance over ESI. */
export class EsiPublicHttp implements EveAffiliations, EveWallet {
  constructor(
    private readonly fetchFn: FetchLike = fetch,
    private readonly userAgent = 'Darkbeacon',
  ) {}

  async affiliations(
    characterIds: readonly number[],
  ): Promise<Map<number, { corporationId: number; allianceId: number | null }>> {
    const found = new Map<number, { corporationId: number; allianceId: number | null }>();
    for (let i = 0; i < characterIds.length; i += BATCH) {
      const response = await this.fetchFn(`${ESI}/characters/affiliation`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(characterIds.slice(i, i + BATCH)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`ESI affiliation answered ${response.status}`);
      const rows = (await response.json()) as Array<{
        character_id: number;
        corporation_id: number;
        alliance_id?: number;
      }>;
      for (const row of rows)
        found.set(row.character_id, {
          corporationId: row.corporation_id,
          allianceId: row.alliance_id ?? null,
        });
    }
    return found;
  }

  async balance(characterId: number, accessToken: string): Promise<number | null> {
    try {
      const response = await this.fetchFn(`${ESI}/characters/${characterId}/wallet`, {
        headers: this.headers({ authorization: `Bearer ${accessToken}` }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as unknown;
      return typeof body === 'number' && Number.isFinite(body) ? body : null;
    } catch {
      return null;
    }
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    return {
      accept: 'application/json',
      'x-compatibility-date': COMPATIBILITY_DATE,
      'user-agent': this.userAgent,
      ...extra,
    };
  }
}
