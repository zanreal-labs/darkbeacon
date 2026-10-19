import type { JumpSpaceData } from '../domain/index.js';

/** The k-space dataset (packages/sde `data/kspace.json`, or an operator's copy in DATA_DIR). */
export interface JumpSpaceSource {
  /** A short hash of the dataset; changes with every new build of it. */
  version: string;
  data: JumpSpaceData;
}

/** My characters as the planner sees them: who owns one, and what its EVE grant allows. */
export interface JumpPilotCharacters {
  /** Name and owner account of a linked character; null for one nobody linked. */
  character(characterId: number): Promise<{ name: string; accountId: string } | null>;
  /** ESI scopes the character's grant holds; empty without a working login. */
  scopes(characterId: number): Promise<string[]>;
}

/**
 * A character's skills and jump fatigue from ESI, with its own login. Throws `PilotEsiError`
 * (domain).
 */
export interface JumpPilotEsi {
  /** Active level of each trained skill, by skill type id (`GET /characters/{id}/skills`). */
  skillLevels(characterId: number): Promise<Map<number, number>>;
  /**
   * When the character's jump fatigue runs out (epoch ms); null when it has none
   * (`GET /characters/{id}/fatigue`).
   */
  fatigueExpiry(characterId: number): Promise<number | null>;
}
