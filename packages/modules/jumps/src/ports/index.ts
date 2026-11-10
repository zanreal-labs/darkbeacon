import type { JumpFuelHub, JumpPlanInput } from '@darkbeacon/shared';
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

/** Public market orders, to price fuel. */
export interface FuelMarket {
  /**
   * The lowest sell price of a type at one station (ISK per unit); null when nobody sells it
   * there. Throws when the market cannot be read.
   */
  lowestSell(regionId: number, stationId: number, typeId: number): Promise<number | null>;
}

/** A route someone shared: the plan request as it was, behind an unguessable token. */
export interface JumpShare {
  token: string;
  request: JumpPlanInput;
  fuelHub: JumpFuelHub;
  /** Account id of whoever shared it (never shown to visitors). */
  createdBy: string;
  createdAt: number;
}

export interface JumpShareStore {
  save(share: JumpShare): Promise<void>;
  find(token: string): Promise<JumpShare | null>;
}
