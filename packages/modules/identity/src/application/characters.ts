import {
  ConflictError,
  ForbiddenError,
  INSTANCE_STREAM,
  newEvent,
  NotFoundError,
  requireAccount,
  ValidationError,
  type Actor,
  type ActorRef,
  type Clock,
  type EventLog,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { CharacterTokens, LinkedCharacter } from '../domain/account.js';
import { ExternalAuthError } from '../domain/errors.js';
import type { PendingAuth } from '../domain/pending-auth.js';
import { EVE_SCOPES, TOKEN_REFRESH_MARGIN_MS } from '../domain/rules.js';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { EveSso, EveTokenSet } from '../ports/eve-sso.js';
import { accountChanged, IDENTITY_ACTOR } from './events.js';
import { asAuthFailure, beginPendingAuth, checkPendingAuth, requireConfigured } from './pending.js';

export interface CharacterDeps {
  /** Null when EVE SSO is not configured. */
  eve: EveSso | null;
  characters: CharacterRepository;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
  redirectUri: string;
}

/** EVE characters: linking through EVE SSO, unlinking, and fresh ESI tokens for tracking. */
export class CharacterService {
  private readonly refreshing = new Map<number, Promise<string | null>>();

  constructor(private readonly deps: CharacterDeps) {}

  get enabled(): boolean {
    return this.deps.eve !== null;
  }

  async startLink(actor: Actor | null, returnTo: unknown): Promise<{ url: string; pending: PendingAuth }> {
    const account = requireAccount(actor);
    const eve = requireConfigured(this.deps.eve, 'EVE');
    const { pending, codeChallenge } = await beginPendingAuth(this.deps.clock, {
      kind: 'eve',
      accountId: account.id,
      returnTo,
    });
    const url = eve.authorizationUrl({
      state: pending.state,
      codeChallenge,
      redirectUri: this.deps.redirectUri,
      scopes: [...EVE_SCOPES],
    });
    return { url, pending };
  }

  /**
   * Finishes EVE SSO and links the character. A character belongs to one account: linking one
   * that another account holds is refused, unless it changed EVE owner since (new owner hash).
   */
  async completeLink(
    actor: Actor | null,
    input: { code: string | undefined; state: string | undefined; pending: PendingAuth | null },
  ): Promise<{ character: LinkedCharacter; returnTo: string }> {
    const account = requireAccount(actor);
    const eve = requireConfigured(this.deps.eve, 'EVE');
    const pending = checkPendingAuth(this.deps.clock, 'eve', input.pending, input.state);
    if (pending.accountId !== account.id)
      throw new ForbiddenError('This link was started by another account');
    if (!input.code) throw new ValidationError('EVE SSO did not return an authorization code');

    const tokens = await asAuthFailure(
      eve.exchangeCode({
        code: input.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: this.deps.redirectUri,
      }),
    );
    const { identity } = tokens;
    const affiliation = await eve.affiliation(identity.characterId);

    const character = await this.deps.uow.transaction(async () => {
      const existing = await this.deps.characters.findById(identity.characterId);
      if (existing && existing.accountId !== account.id && existing.ownerHash === identity.ownerHash) {
        throw new ConflictError(
          `${identity.characterName} is already linked to another account. Unlink it there first.`,
        );
      }
      const now = this.deps.clock.now();
      if (existing && existing.accountId !== account.id) {
        // Sold: the former owner's maps must stop seeing this character through them.
        await this.left(existing, { kind: 'account', id: account.id });
      }
      const character: LinkedCharacter = {
        id: identity.characterId,
        accountId: account.id,
        name: identity.characterName,
        corporationId: affiliation.corporationId,
        allianceId: affiliation.allianceId,
        ownerHash: identity.ownerHash,
        tokenValid: true,
        linkedAt: existing?.accountId === account.id ? existing.linkedAt : now,
        updatedAt: now,
      };
      await this.deps.characters.upsert(character);
      await this.deps.characters.saveTokens(character.id, storedTokens(tokens));
      return character;
    });
    return { character, returnTo: pending.returnTo };
  }

  async unlink(actor: Actor | null, characterId: number): Promise<void> {
    const account = requireAccount(actor);
    await this.deps.uow.transaction(async () => {
      const character = await this.deps.characters.findById(characterId);
      if (character?.accountId !== account.id) throw new NotFoundError('Character');
      await this.deps.characters.delete(characterId);
      await this.left(character, { kind: 'account', id: account.id });
    });
  }

  listForAccount(accountId: string): Promise<LinkedCharacter[]> {
    return this.deps.characters.listForAccount(accountId);
  }

  /** Name and owner account of a linked character (CharacterTokenSource of tracking). */
  async character(characterId: number): Promise<{ name: string; accountId: string } | null> {
    const character = await this.deps.characters.findById(characterId);
    return character ? { name: character.name, accountId: character.accountId } : null;
  }

  /**
   * A valid ESI access token, refreshed when it is about to expire. EVE rotates refresh tokens,
   * so concurrent callers share one refresh. Null when the character has no working token.
   */
  accessToken(characterId: number): Promise<string | null> {
    const running = this.refreshing.get(characterId);
    if (running) return running;
    const work = this.freshToken(characterId).finally(() => this.refreshing.delete(characterId));
    this.refreshing.set(characterId, work);
    return work;
  }

  /**
   * The refresh and affiliation calls take a while, and the character may be unlinked or
   * claimed by another account meanwhile; the results are only stored while it still belongs
   * to the account it was read for.
   */
  private async freshToken(characterId: number): Promise<string | null> {
    const character = await this.deps.characters.findById(characterId);
    if (!character?.tokenValid) return null;
    const tokens = await this.deps.characters.getTokens(characterId);
    if (!tokens) return null;
    if (tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.deps.clock.now()) return tokens.accessToken;
    if (!this.deps.eve) return null;

    let refreshed: EveTokenSet;
    try {
      refreshed = await this.deps.eve.refresh(tokens.refreshToken);
    } catch (error) {
      if (!(error instanceof ExternalAuthError)) throw error;
      await this.deps.characters.updateState(characterId, character.accountId, {
        tokenValid: false,
        updatedAt: this.deps.clock.now(),
      });
      return null;
    }
    // Corporation and alliance feed access rules; keep them current while the character is used.
    const affiliation = await this.deps.eve.affiliation(characterId).catch(() => null);
    return this.deps.uow.transaction(async () => {
      const kept = await this.deps.characters.updateState(characterId, character.accountId, {
        ...affiliation,
        updatedAt: this.deps.clock.now(),
      });
      if (!kept) return null;
      await this.deps.characters.saveTokens(characterId, storedTokens(refreshed));
      if (
        affiliation &&
        (affiliation.corporationId !== character.corporationId ||
          affiliation.allianceId !== character.allianceId)
      ) {
        await this.deps.events.append([
          accountChanged(character.accountId, IDENTITY_ACTOR, this.deps.clock.now()),
        ]);
      }
      return refreshed.accessToken;
    });
  }

  /** The character no longer belongs to its account: tracking and map access must follow. */
  private async left(character: LinkedCharacter, actor: ActorRef): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.events.append([
      newEvent({
        stream: INSTANCE_STREAM,
        type: 'character.unlinked',
        actor,
        data: { characterId: character.id },
        occurredAt: now,
      }),
      accountChanged(character.accountId, actor, now),
    ]);
  }
}

function storedTokens(tokens: EveTokenSet): CharacterTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.identity.scopes,
  };
}
