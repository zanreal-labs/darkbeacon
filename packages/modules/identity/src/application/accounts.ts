import {
  actorRef,
  ConflictError,
  ForbiddenError,
  INSTANCE_STREAM,
  newEvent,
  newId,
  NotFoundError,
  requireAccount,
  requireInstanceRole,
  type AccountActor,
  type Actor,
  type Clock,
  type EventLog,
  type InstanceRole,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { AccountDto, AdminAccountDto, CharacterDto, EventPayloads, MeDto } from '@darkbeacon/shared';
import type { Account, LinkedCharacter } from '../domain/account.js';
import { effectiveInstanceRole, initialInstanceRole, WAYPOINT_SCOPE } from '../domain/rules.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { DiscordGuildPolicy, DiscordLinkRepository } from '../ports/discord-link-repository.js';
import type { DiscordProfile } from '../ports/identity-provider.js';

export interface AccountDeps {
  accounts: AccountRepository;
  characters: CharacterRepository;
  discordLinks: DiscordLinkRepository;
  guildPolicy: DiscordGuildPolicy;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
}

/** Everything an account can be matched by in map access rules. */
export interface AccountSubjects {
  accountId: string;
  characterIds: number[];
  corporationIds: number[];
  allianceIds: number[];
  discordRoles: Array<{ guildId: string; roleId: string }>;
}

export function toAccountDto(account: Account, instanceRole: InstanceRole): AccountDto {
  return {
    id: account.id,
    discordId: account.discordId,
    name: account.name,
    avatarUrl: account.avatarUrl,
    instanceRole,
    createdAt: account.createdAt,
  };
}

export function toCharacterDto(character: LinkedCharacter): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    corporationId: character.corporationId,
    allianceId: character.allianceId,
    tokenValid: character.tokenValid,
    linkedAt: character.linkedAt,
  };
}

/** Accounts, their instance roles and what they can be matched by. */
export class AccountService {
  constructor(private readonly deps: AccountDeps) {}

  /** The stored role, raised to admin by a Discord guild role configured in the instance settings. */
  async effectiveRole(account: Account): Promise<InstanceRole> {
    if (account.instanceRole !== 'user') return account.instanceRole;
    const link = await this.deps.discordLinks.find(account.id);
    if (!link || link.guildRoles.length === 0) return 'user';
    return effectiveInstanceRole('user', await this.deps.guildPolicy.grantsAdmin(link.guildRoles));
  }

  async actorFor(account: Account): Promise<AccountActor> {
    return { kind: 'account', id: account.id, instanceRole: await this.effectiveRole(account) };
  }

  async me(actor: Actor | null): Promise<MeDto> {
    const { id, instanceRole } = requireAccount(actor);
    const account = await this.deps.accounts.findById(id);
    if (!account) throw new NotFoundError('Account');
    const characters = await this.deps.characters.listForAccount(id);
    // A main character that was unlinked since no longer counts.
    const main = characters.some((c) => c.id === account.mainCharacterId) ? account.mainCharacterId : null;
    return {
      account: { ...toAccountDto(account, instanceRole), mainCharacterId: main ?? null },
      characters: await Promise.all(
        characters.map(async (character) => ({
          ...toCharacterDto(character),
          canSetWaypoints:
            character.tokenValid &&
            ((await this.deps.characters.getTokens(character.id))?.scopes.includes(WAYPOINT_SCOPE) ?? false),
        })),
      ),
    };
  }

  /** Picks which of the account's own characters it acts as by default. */
  async setMainCharacter(actor: Actor | null, characterId: number): Promise<MeDto> {
    const { id } = requireAccount(actor);
    await this.deps.uow.transaction(async () => {
      const character = await this.deps.characters.findById(characterId);
      if (character?.accountId !== id) throw new NotFoundError('Character');
      const account = await this.deps.accounts.findById(id);
      if (!account) throw new NotFoundError('Account');
      await this.deps.accounts.update({
        ...account,
        mainCharacterId: characterId,
        updatedAt: this.deps.clock.now(),
      });
    });
    return this.me(actor);
  }

  async list(actor: Actor | null): Promise<AdminAccountDto[]> {
    requireInstanceRole(actor, 'admin');
    const accounts = await this.deps.accounts.list();
    return Promise.all(accounts.map((a) => this.adminDto(a)));
  }

  /** Grants or revokes instance admin. The owner's role only changes through a transfer. */
  async setRole(actor: Actor | null, accountId: string, role: 'admin' | 'user'): Promise<AdminAccountDto> {
    const admin = requireInstanceRole(actor, 'admin');
    if (accountId === admin.id) throw new ForbiddenError('You cannot change your own role');
    return this.deps.uow.transaction(async () => {
      const target = await this.deps.accounts.findById(accountId);
      if (!target) throw new NotFoundError('Account');
      if (target.instanceRole === 'owner')
        throw new ForbiddenError('The owner can only be changed by a transfer');
      if (target.instanceRole !== role) {
        const updated = { ...target, instanceRole: role, updatedAt: this.deps.clock.now() };
        await this.deps.accounts.update(updated);
        await this.roleChanged(admin, updated, target);
        return this.adminDto(updated);
      }
      return this.adminDto(target);
    });
  }

  /** The owner hands the instance to another account and becomes an admin. */
  async transferOwnership(actor: Actor | null, accountId: string): Promise<void> {
    const caller = requireAccount(actor);
    await this.deps.uow.transaction(async () => {
      const owner = await this.deps.accounts.findById(caller.id);
      if (owner?.instanceRole !== 'owner') throw new ForbiddenError('Only the owner can transfer ownership');
      if (accountId === owner.id) throw new ConflictError('You already own this instance');
      const target = await this.deps.accounts.findById(accountId);
      if (!target) throw new NotFoundError('Account');
      const now = this.deps.clock.now();
      // Demote first: at most one owner may exist at any time.
      const former = { ...owner, instanceRole: 'admin' as const, updatedAt: now };
      const next = { ...target, instanceRole: 'owner' as const, updatedAt: now };
      await this.deps.accounts.update(former);
      await this.deps.accounts.update(next);
      await this.roleChanged(caller, former, owner);
      await this.roleChanged(caller, next, target);
    });
  }

  /** Finds or creates the account of a Discord user and refreshes its name and avatar. */
  async upsertDiscordAccount(profile: DiscordProfile): Promise<Account> {
    const name = (profile.globalName ?? profile.username).slice(0, 64);
    return this.withCreateRetry(async () => {
      const existing = await this.deps.accounts.findByDiscordId(profile.id);
      if (!existing) return this.create({ discordId: profile.id, name, avatarUrl: profile.avatarUrl });
      if (existing.name === name && existing.avatarUrl === profile.avatarUrl) return existing;
      const updated = { ...existing, name, avatarUrl: profile.avatarUrl, updatedAt: this.deps.clock.now() };
      await this.deps.accounts.update(updated);
      return updated;
    });
  }

  /** The local account of a dev login (no Discord id), created on first use. */
  devAccount(name: string): Promise<Account> {
    return this.withCreateRetry(
      async () =>
        (await this.deps.accounts.findByName(name)) ??
        this.create({ discordId: null, name, avatarUrl: null }),
    );
  }

  async subjectsOf(accountId: string): Promise<AccountSubjects> {
    const [characters, link] = await Promise.all([
      this.deps.characters.listForAccount(accountId),
      this.deps.discordLinks.find(accountId),
    ]);
    const unique = (ids: Array<number | null>) => [...new Set(ids.filter((id): id is number => id !== null))];
    return {
      accountId,
      characterIds: characters.map((c) => c.id),
      corporationIds: unique(characters.map((c) => c.corporationId)),
      allianceIds: unique(characters.map((c) => c.allianceId)),
      discordRoles: link?.guildRoles ?? [],
    };
  }

  private async create(input: Pick<Account, 'discordId' | 'name' | 'avatarUrl'>): Promise<Account> {
    const now = this.deps.clock.now();
    const account: Account = {
      id: newId(),
      ...input,
      instanceRole: initialInstanceRole(await this.deps.accounts.count()),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: null,
    };
    await this.deps.accounts.insert(account);
    return account;
  }

  /**
   * Two first logins at once may both try to become owner, or one Discord user may log in
   * twice in parallel; the unique indexes reject the loser, whose second attempt sees the winner.
   */
  private async withCreateRetry(work: () => Promise<Account>): Promise<Account> {
    try {
      return await this.deps.uow.transaction(work);
    } catch {
      return this.deps.uow.transaction(work);
    }
  }

  private async adminDto(account: Account): Promise<AdminAccountDto> {
    return { ...toAccountDto(account, await this.effectiveRole(account)), lastSeenAt: account.lastSeenAt };
  }

  private async roleChanged(actor: Actor, account: Account, before: Account): Promise<void> {
    const data: EventPayloads['access.role_changed'] = {
      accountId: account.id,
      role: await this.effectiveRole(account),
    };
    await this.deps.events.append([
      newEvent({
        stream: INSTANCE_STREAM,
        type: 'access.role_changed',
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
        before: { accountId: before.id, role: await this.effectiveRole(before) },
      }),
    ]);
  }
}
