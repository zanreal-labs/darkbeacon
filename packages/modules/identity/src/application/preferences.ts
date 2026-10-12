import { requireAccount, ValidationError, type Actor, type Clock } from '@darkbeacon/core';
import type { UpdateUserPreferencesRequest, UserPreferencesDto } from '@darkbeacon/shared';
import type { UserPreferenceRepository } from '../ports/user-preferences.js';

/** How much one area may hold once serialised; preferences are switches and short lists. */
export const PREFERENCE_AREA_MAX_BYTES = 16 * 1024;
/** How many areas one account may keep. */
export const PREFERENCE_AREAS_MAX = 32;

const AREA = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * "My preferences": options of one person kept on the server, so they follow them between
 * browsers and can be exported, imported and reset in one place. The server stores each area
 * as given; the web app that owns an area reads it with its own defaults.
 */
export class UserPreferences {
  constructor(private readonly deps: { preferences: UserPreferenceRepository; clock: Clock }) {}

  async get(actor: Actor | null): Promise<UserPreferencesDto> {
    const account = requireAccount(actor);
    const rows = await this.deps.preferences.list(account.id);
    return {
      preferences: Object.fromEntries(rows.map((r) => [r.area, r.value])),
      updatedAt: rows.reduce((max, r) => Math.max(max, r.updatedAt), 0),
    };
  }

  async update(actor: Actor | null, request: UpdateUserPreferencesRequest): Promise<UserPreferencesDto> {
    const account = requireAccount(actor);
    const areas = Object.entries(request.preferences);
    for (const [area, value] of areas) {
      if (!AREA.test(area)) throw new ValidationError(`"${area}" is not a preference area`);
      if (value !== null && JSON.stringify(value).length > PREFERENCE_AREA_MAX_BYTES)
        throw new ValidationError(`The "${area}" preferences are too large`);
    }
    const current = await this.deps.preferences.list(account.id);
    const kept = new Set(current.map((r) => r.area));
    for (const [area, value] of areas) {
      if (value === null) kept.delete(area);
      else kept.add(area);
    }
    if (kept.size > PREFERENCE_AREAS_MAX) throw new ValidationError('Too many preference areas');
    await this.deps.preferences.put(account.id, request.preferences, this.deps.clock.now());
    return this.get(actor);
  }
}
