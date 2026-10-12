import { z } from 'zod';
import { EveId } from './common.js';

/**
 * How auto-mapping treats jumps on a map, next to its scopes. Every field is optional: absent
 * means the default, so maps made before the option keep working the same.
 */
export const AutoMapRulesDto = z.object({
  /** Systems auto-mapping never adds; absent: Jita (as in Wanderer). Abyssal space never is. */
  excludedSystems: z.array(EveId).max(200).optional(),
  /**
   * `either` (default): a jump is mapped when either end is in scope, so the exit into known
   * space shows. `both`: Wanderer's rule, a known-space jump needs both ends in scope.
   */
  gateRule: z.enum(['either', 'both']).optional(),
  /** A jump between the ends of a known Ansiblex is drawn as a bridge (default on). */
  typeBridges: z.boolean().optional(),
});
export type AutoMapRulesDto = z.infer<typeof AutoMapRulesDto>;

/** Jita, the only system excluded by default. */
export const DEFAULT_EXCLUDED_SYSTEMS: readonly number[] = [30000142];
