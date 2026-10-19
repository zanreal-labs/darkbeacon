import type { JumpSkillLevels } from './formulas.js';

/**
 * The skills the planner reads by their type ids, as `GET /universe/types/{id}` names them
 * (checked 2026-10-19): 21611 "Jump Drive Calibration" and 21610 "Jump Fuel Conservation" (group
 * 275 Navigation), 29029 "Jump Freighters" (group 257 Spaceship Command).
 */
export const JUMP_SKILL_TYPE_IDS: Readonly<Record<keyof JumpSkillLevels, number>> = {
  jdc: 21611,
  jfc: 21610,
  jf: 29029,
};

/**
 * The ESI scopes of the pilot's skills (`GET /characters/{id}/skills`) and jump fatigue
 * (`GET /characters/{id}/fatigue`); together the opt-in extra `jumps`.
 */
export const JUMP_PILOT_SCOPES = {
  skills: 'esi-skills.read_skills.v1',
  fatigue: 'esi-characters.read_fatigue.v1',
} as const;

/**
 * The planner's skill levels from ESI's active levels by skill type id: a skill the character
 * has not trained is level 0 (ESI lists trained skills only).
 */
export function jumpSkillsFrom(levels: ReadonlyMap<number, number>): JumpSkillLevels {
  const level = (id: number) => Math.max(0, Math.min(5, Math.trunc(levels.get(id) ?? 0)));
  return {
    jdc: level(JUMP_SKILL_TYPE_IDS.jdc),
    jfc: level(JUMP_SKILL_TYPE_IDS.jfc),
    jf: level(JUMP_SKILL_TYPE_IDS.jf),
  };
}

/**
 * Why ESI gave nothing for a pilot: EVE refused (401/403: the grant lacks the scope or is gone),
 * no working login, or no answer.
 */
export class PilotEsiError extends Error {
  constructor(
    readonly reason: 'forbidden' | 'no-token' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PilotEsiError';
  }
}
