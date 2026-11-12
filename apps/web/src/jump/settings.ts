import type { JumpFuelHub, JumpGateUse, JumpSkills } from '@darkbeacon/shared';
import { DEFAULT_FREIGHT, freightTermsFrom, type FreightTerms } from './freight';

/** What the planner remembers per browser (a convenience; nothing breaks without it). */
export interface PlannerSettings {
  /**
   * 3: no stargates by default (older saves had gates after the last jump without asking);
   * 2: landing at stations became the default.
   */
  version: 3;
  ship: string | null;
  /** The character whose skills and fatigue ESI fills in; null: my main (else the first). */
  pilot: number | null;
  skills: JumpSkills;
  /** The levels were picked by hand (not the defaults): no warning that they are only assumed. */
  skillsByHand: boolean;
  gates: JumpGateUse;
  /** Where fuel is priced (lowest sell at the hub station). */
  fuelHub: JumpFuelHub;
  /** The pilot's freight pricing, for the quote under a jump freighter's route. */
  freight: FreightTerms;
  preferStations: boolean;
  outlaw: boolean;
  maxFatigue: number | null;
  fatigueNow: number;
  /** Avoided systems and regions by name. */
  avoidSystems: string[];
  avoidRegions: string[];
  bridgeTonnes: number | null;
  /** Systems picked as a start or destination, by name, most recent first. */
  recent: string[];
}

const FUEL_HUBS: readonly JumpFuelHub[] = ['jita', 'amarr', 'dodixie', 'rens', 'hek'];

export const DEFAULT_SETTINGS: PlannerSettings = {
  version: 3,
  ship: null,
  pilot: null,
  skills: { jdc: 5, jfc: 4, jf: 4 },
  skillsByHand: false,
  gates: 'never',
  fuelHub: 'jita',
  freight: DEFAULT_FREIGHT,
  preferStations: true,
  outlaw: false,
  maxFatigue: null,
  fatigueNow: 0,
  avoidSystems: [],
  avoidRegions: [],
  bridgeTonnes: null,
  recent: [],
};

export const SETTINGS_KEY = 'dbk.jump-planner.v1';

export function loadSettings(): PlannerSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlannerSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      version: 3,
      // Saved before landing at stations was the default: it was off only because it was.
      preferStations: (parsed.version ?? 1) >= 2 ? parsed.preferStations !== false : true,
      // Saved before no gates was the default: gates after the last jump only because it was.
      gates: (parsed.version ?? 1) >= 3 && parsed.gates ? parsed.gates : 'never',
      skills: { ...DEFAULT_SETTINGS.skills, ...parsed.skills },
      pilot: typeof parsed.pilot === 'number' ? parsed.pilot : null,
      skillsByHand: parsed.skillsByHand === true,
      freight: freightTermsFrom(parsed.freight),
      fuelHub: FUEL_HUBS.includes(parsed.fuelHub as JumpFuelHub) ? (parsed.fuelHub as JumpFuelHub) : 'jita',
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((n) => typeof n === 'string') : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PlannerSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and blocked storage: the planner just forgets.
  }
}
