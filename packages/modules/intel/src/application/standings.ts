import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import type { StandingsDto } from '@darkbeacon/shared';
import { MINUTE } from '../domain/activity.js';
import { mergeStandings, type CharacterContacts } from '../domain/standings.js';
import type { ContactsSource, IntelRepository, StandingPilots } from '../ports/index.js';

export const CONTACT_SCOPES = {
  character: 'esi-characters.read_contacts.v1',
  corporation: 'esi-corporations.read_contacts.v1',
  alliance: 'esi-alliances.read_contacts.v1',
} as const;

/** ESI caches contacts for five minutes; standings change rarely, so a quarter of an hour is kept. */
const TTL = 15 * MINUTE;

/**
 * The signed-in account's standings, from the contacts of its characters, their corporations and
 * alliances (each list read with a character that has the scope), kept a quarter of an hour.
 */
export class Standings {
  private readonly cache = new Map<string, { value: StandingsDto; at: number }>();

  constructor(
    private readonly deps: {
      pilots: StandingPilots;
      contacts: ContactsSource;
      clock: Clock;
      /** Standings set by hand; without it there are none. */
      overrides?: Pick<IntelRepository, 'standingOverrides' | 'setStandingOverride'>;
    },
  ) {}

  /** Sets the account's standing towards someone by hand; null goes back to contacts. */
  async set(actor: Actor | null, entityId: number, standing: number | null): Promise<StandingsDto> {
    const account = requireAccount(actor);
    if (!this.deps.overrides) throw new Error('standings cannot be set on this instance');
    const value = standing === null ? null : Math.max(-10, Math.min(10, standing));
    await this.deps.overrides.setStandingOverride(account.id, entityId, value, this.deps.clock.now());
    return this.forAccount(actor);
  }

  async forAccount(actor: Actor | null): Promise<StandingsDto> {
    const account = requireAccount(actor);
    const now = this.deps.clock.now();
    const overrides = (await this.deps.overrides?.standingOverrides(account.id)) ?? new Map<number, number>();
    const hit = this.cache.get(account.id);
    if (hit && now - hit.at < TTL) return withOverrides(hit.value, overrides);
    const characters = await this.deps.pilots.characters(account.id);
    const lists: CharacterContacts[] = [];
    let missingScopes = false;
    // Corporations and alliances shared by several characters are read once.
    const read = new Map<string, Promise<CharacterContacts['alliance']>>();
    for (const c of characters) {
      const has = (scope: string) => c.scopes.includes(scope);
      if (!Object.values(CONTACT_SCOPES).every(has)) missingScopes = true;
      const token = c.scopes.length > 0 ? await this.deps.pilots.accessToken(c.id) : null;
      const list = (kind: keyof typeof CONTACT_SCOPES, id: number | null) => {
        if (id === null || !token || !has(CONTACT_SCOPES[kind])) return Promise.resolve(null);
        const key = `${kind}:${id}`;
        if (!read.has(key)) {
          read.set(
            key,
            this.deps.contacts
              .contacts({ kind, id }, token)
              .then((r) => (r.ok ? r.data : null))
              .catch(() => null),
          );
        }
        return read.get(key)!;
      };
      lists.push({
        characterId: c.id,
        corporationId: c.corporationId,
        allianceId: c.allianceId,
        character: await list('character', c.id),
        corporation: await list('corporation', c.corporationId),
        alliance: await list('alliance', c.allianceId),
      });
    }
    const merged = mergeStandings(lists);
    const value: StandingsDto = {
      standings: [...merged].map(([id, standing]) => ({ id, standing })),
      missingScopes,
      overrides: [],
    };
    this.cache.set(account.id, { value, at: now });
    return withOverrides(value, overrides);
  }
}

/** Standings set by hand win over the contacts'. */
function withOverrides(value: StandingsDto, overrides: ReadonlyMap<number, number>): StandingsDto {
  if (overrides.size === 0) return value;
  return {
    ...value,
    standings: [
      ...value.standings.filter((s) => !overrides.has(s.id)),
      ...[...overrides].map(([id, standing]) => ({ id, standing })),
    ],
    overrides: [...overrides.keys()],
  };
}
