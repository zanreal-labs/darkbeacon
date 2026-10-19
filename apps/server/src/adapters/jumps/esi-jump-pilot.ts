import type { Clock } from '@darkbeacon/core';
import { PilotEsiError, type JumpPilotEsi } from '@darkbeacon/jumps';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

const ESI = 'https://esi.evetech.net';

/**
 * How long an answer is kept when ESI sends no `Expires`: what https://esi.evetech.net/meta/openapi.json
 * gives as `x-client-cache-ttl` (compatibility date 2026-08-18): 60 s for skills, 300 s for fatigue.
 */
const SKILLS_TTL_MS = 60_000;
const FATIGUE_TTL_MS = 300_000;

/**
 * A character's skills (`GET /characters/{id}/skills`, scope `esi-skills.read_skills.v1`) and jump
 * fatigue (`GET /characters/{id}/fatigue`, scope `esi-characters.read_fatigue.v1`) with its own
 * login. Each answer is kept until ESI's `Expires` (else the spec's cache time), since asking
 * again earlier gets the same answer from ESI's cache.
 */
export class EsiJumpPilot implements JumpPilotEsi {
  private readonly cache = new Map<string, { until: number; value: unknown }>();

  constructor(
    private readonly options: {
      clock: Clock;
      userAgent: string;
      accessToken(characterId: number): Promise<string | null>;
      fetch?: typeof fetch;
      baseUrl?: string;
    },
  ) {}

  skillLevels(characterId: number): Promise<Map<number, number>> {
    return this.read(`/characters/${characterId}/skills`, characterId, SKILLS_TTL_MS, (body) => {
      const { skills } = body as { skills?: Array<{ skill_id: number; active_skill_level: number }> };
      return new Map((skills ?? []).map((s) => [s.skill_id, s.active_skill_level]));
    });
  }

  fatigueExpiry(characterId: number): Promise<number | null> {
    return this.read(`/characters/${characterId}/fatigue`, characterId, FATIGUE_TTL_MS, (body) => {
      const { jump_fatigue_expire_date: expires } = body as { jump_fatigue_expire_date?: string };
      const at = expires ? Date.parse(expires) : Number.NaN;
      return Number.isFinite(at) ? at : null;
    });
  }

  private async read<T>(
    path: string,
    characterId: number,
    ttl: number,
    parse: (body: unknown) => T,
  ): Promise<T> {
    const now = this.options.clock.now();
    const cached = this.cache.get(path);
    if (cached && cached.until > now) return cached.value as T;
    const token = await this.options.accessToken(characterId);
    if (!token) throw new PilotEsiError('no-token', 'No working EVE login');
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl ?? ESI}${path}`, {
      headers: {
        accept: 'application/json',
        'user-agent': this.options.userAgent,
        'x-compatibility-date': ESI_COMPATIBILITY_DATE,
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response) throw new PilotEsiError('unavailable', 'EVE did not answer');
    if (response.status === 401 || response.status === 403)
      throw new PilotEsiError('forbidden', `ESI answered ${response.status}`);
    if (!response.ok) throw new PilotEsiError('unavailable', `ESI answered ${response.status}`);
    const value = parse(await response.json());
    const expires = Date.parse(response.headers.get('expires') ?? '');
    // `Expires` is ESI's own clock; never kept longer than the spec says, nor for less than a second.
    const until = Number.isFinite(expires) ? Math.min(Math.max(expires, now + 1000), now + ttl) : now + ttl;
    this.cache.set(path, { until, value });
    return value;
  }
}
