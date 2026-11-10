import type { JumpFuelHub, JumpGateUse, JumpSkills } from '@darkbeacon/shared';
import { DEFAULT_FREIGHT, freightTermsFrom, type FreightTerms } from './freight';
import type { StarModel } from './model';

/** What the planner remembers per browser (a convenience; nothing breaks without it). */
export interface PlannerSettings {
  ship: string | null;
  /** The character whose skills and fatigue ESI fills in; null: my main (else the first). */
  pilot: number | null;
  skills: JumpSkills;
  /** The levels were picked by hand (not the defaults): no warning that they are only assumed. */
  skillsByHand: boolean;
  gates: JumpGateUse;
  /** Back to the start after the destination. */
  roundTrip: boolean;
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
  ansiblex: string;
  bridgeTonnes: number | null;
  /** Systems picked as a start or destination, by name, most recent first. */
  recent: string[];
}

const FUEL_HUBS: readonly JumpFuelHub[] = ['jita', 'amarr', 'dodixie', 'rens', 'hek'];

export const DEFAULT_SETTINGS: PlannerSettings = {
  ship: null,
  pilot: null,
  skills: { jdc: 5, jfc: 4, jf: 4 },
  skillsByHand: false,
  gates: 'finish',
  roundTrip: false,
  fuelHub: 'jita',
  freight: DEFAULT_FREIGHT,
  preferStations: false,
  outlaw: false,
  maxFatigue: null,
  fatigueNow: 0,
  avoidSystems: [],
  avoidRegions: [],
  ansiblex: '',
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
      skills: { ...DEFAULT_SETTINGS.skills, ...parsed.skills },
      pilot: typeof parsed.pilot === 'number' ? parsed.pilot : null,
      skillsByHand: parsed.skillsByHand === true,
      roundTrip: parsed.roundTrip === true,
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

export interface AnsiblexParse {
  pairs: Array<[number, number]>;
  /** Lines that did not name two known systems. */
  problems: string[];
}

/**
 * Ansiblex bridges, one per line: two system names with `>`, `»`, `<>`, `->`, `→`, `↔`, a dash
 * or a comma between them (as people paste them from notes and Dotlan lists).
 */
export function parseAnsiblex(text: string, model: StarModel): AnsiblexParse {
  const byName = new Map<string, number>();
  for (let i = 0; i < model.size; i++) byName.set(model.keys[i]!, i);
  const pairs: Array<[number, number]> = [];
  const problems: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line
      .split(/\s*(?:<->|<>|->|=>|»|›|→|↔|>|,|\t|\s[-–—]\s)\s*/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const a = parts.length === 2 ? byName.get(parts[0]!) : undefined;
    const b = parts.length === 2 ? byName.get(parts[1]!) : undefined;
    if (a === undefined || b === undefined) problems.push(line);
    else pairs.push([a, b]);
  }
  return { pairs, problems };
}
