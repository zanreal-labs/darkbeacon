/** Per-person options, one JSON value per area (`local`, `sidebar`, `signatures`, ...). */
export interface UserPreferenceRepository {
  list(accountId: string): Promise<Array<{ area: string; value: unknown; updatedAt: number }>>;
  /** Sets the areas given; a null value removes that area. */
  put(accountId: string, areas: Record<string, unknown>, now: number): Promise<void>;
}
