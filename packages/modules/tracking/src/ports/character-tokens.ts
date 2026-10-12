/** Provided by identity: a valid (refreshed when needed) ESI access token for a character. */
export interface CharacterTokenSource {
  accessToken(characterId: number): Promise<string | null>;
  /** Name and owner account of a linked character, null when not linked. */
  character(characterId: number): Promise<{ name: string; accountId: string } | null>;
  /**
   * Corporation and alliance of linked characters (unknown ids left out), shown next to them on
   * maps. Optional: sources without it leave presence as it is.
   */
  linked?(
    characterIds: readonly number[],
  ): Promise<Array<{ id: number; corporationId: number; allianceId: number | null }>>;
}
