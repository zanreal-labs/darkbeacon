import type { Clock, EventLog, UnitOfWork } from '@darkbeacon/core';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { EveAffiliations } from '../ports/eve-public.js';
import { accountChanged, IDENTITY_ACTOR } from './events.js';

/** ESI answers at most this many ids per affiliation call. */
const BATCH = 1000;

/**
 * Keeps every linked character's corporation and alliance current, so access rules that match
 * them follow a corporation change within minutes instead of at the next token refresh. A
 * change marks the account changed: map access is checked again and tracking that is no longer
 * allowed stops.
 */
export class AffiliationRefresh {
  constructor(
    private readonly deps: {
      characters: CharacterRepository;
      esi: EveAffiliations;
      events: EventLog;
      uow: UnitOfWork;
      clock: Clock;
    },
  ) {}

  /** One pass over every linked character; returns how many changed. */
  async run(): Promise<number> {
    // Demo and dev-login characters are made up (owner hash `dev`); ESI knows none of them.
    const all = (await this.deps.characters.listAll()).filter((c) => c.ownerHash !== 'dev');
    let changed = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      const found = await this.deps.esi.affiliations(batch.map((c) => c.id));
      await this.deps.uow.transaction(async () => {
        const now = this.deps.clock.now();
        const accounts = new Set<string>();
        for (const character of batch) {
          const next = found.get(character.id);
          if (!next) continue;
          if (next.corporationId === character.corporationId && next.allianceId === character.allianceId)
            continue;
          // Only while it still belongs to the account it was read for.
          const kept = await this.deps.characters.updateState(character.id, character.accountId, {
            ...next,
            updatedAt: now,
          });
          if (!kept) continue;
          accounts.add(character.accountId);
          changed += 1;
        }
        if (accounts.size > 0)
          await this.deps.events.append([...accounts].map((id) => accountChanged(id, IDENTITY_ACTOR, now)));
      });
    }
    return changed;
  }
}
