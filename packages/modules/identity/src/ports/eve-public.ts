/** Public ESI reads identity needs beyond EVE SSO (no client credentials required). */
export interface EveAffiliations {
  /**
   * Corporation and alliance of many characters at once (`POST /characters/affiliation`, up to
   * 1000 ids a call). Ids ESI does not know are left out of the answer.
   */
  affiliations(
    characterIds: readonly number[],
  ): Promise<Map<number, { corporationId: number; allianceId: number | null }>>;
}

/** A character's own wallet (`GET /characters/{id}/wallet`, scope `esi-wallet.read_character_wallet.v1`). */
export interface EveWallet {
  /** ISK, or null when ESI did not answer. */
  balance(characterId: number, accessToken: string): Promise<number | null>;
}
