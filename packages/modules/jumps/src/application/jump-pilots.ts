import { NotFoundError, requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import { fatigueMinutesLeft, type JumpPilotDto } from '@darkbeacon/shared';
import { JUMP_PILOT_SCOPES, jumpSkillsFrom, PilotEsiError } from '../domain/index.js';
import type { JumpPilotCharacters, JumpPilotEsi } from '../ports/index.js';

/** What to tell the pilot when ESI gave nothing for a part the grant covers. */
const PROBLEMS: Record<PilotEsiError['reason'], string> = {
  'no-token': 'The EVE login of this character no longer works; link it again.',
  forbidden: 'EVE refused to share skills and fatigue; link the character again to allow them.',
  unavailable: 'EVE did not answer; try again in a moment.',
};

/**
 * The jump skills and fatigue of one of my characters, from ESI, to fill the planner. Each part
 * is read only when the grant covers it (the opt-in extra `jumps`); what it lacks is named, so
 * the pilot can link the character again with it. One part failing leaves the other.
 */
export class JumpPilots {
  constructor(private readonly deps: { characters: JumpPilotCharacters; esi: JumpPilotEsi; clock: Clock }) {}

  async pilot(actor: Actor | null, characterId: number): Promise<JumpPilotDto> {
    const account = requireAccount(actor);
    const own = await this.deps.characters.character(characterId);
    if (own?.accountId !== account.id) throw new NotFoundError('Character');
    const scopes = await this.deps.characters.scopes(characterId);
    const has = (scope: string) => scopes.includes(scope);
    const missingScopes = Object.values(JUMP_PILOT_SCOPES).filter((s) => !has(s));
    const [skills, fatigue] = await Promise.allSettled([
      has(JUMP_PILOT_SCOPES.skills) ? this.deps.esi.skillLevels(characterId) : Promise.resolve(null),
      has(JUMP_PILOT_SCOPES.fatigue) ? this.deps.esi.fatigueExpiry(characterId) : Promise.resolve(undefined),
    ]);
    for (const r of [skills, fatigue]) {
      if (r.status === 'rejected' && !(r.reason instanceof PilotEsiError)) throw r.reason;
    }
    const failed = [skills, fatigue].flatMap((r) =>
      r.status === 'rejected' ? [r.reason as PilotEsiError] : [],
    );
    const now = this.deps.clock.now();
    const expiresAt = fatigue.status === 'fulfilled' ? fatigue.value : undefined;
    const left = expiresAt === undefined ? null : fatigueMinutesLeft(expiresAt, now);
    return {
      characterId,
      skills: skills.status === 'fulfilled' && skills.value ? jumpSkillsFrom(skills.value) : null,
      fatigueMinutes: left,
      // Fatigue that has run out is none.
      fatigueExpiresAt: left === null || left === 0 ? null : expiresAt!,
      missingScopes,
      problem: failed[0] ? PROBLEMS[failed[0].reason] : null,
      checkedAt: now,
    };
  }
}
