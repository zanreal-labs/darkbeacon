import {
  AUDIT_STREAM,
  actorRef,
  ForbiddenError,
  newEvent,
  newId,
  NotFoundError,
  requireInstanceRole,
  type Actor,
  type ActorRef,
  type Clock,
  type EventLog,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { AuditEventPayloads, CreateInviteRequest, InviteDto } from '@darkbeacon/shared';
import type { Invite } from '../domain/account.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { IdentityProvider } from '../ports/identity-provider.js';
import type { InviteRepository, SignUpRules } from '../ports/invite-repository.js';
import { randomToken, sha256 } from './crypto.js';

export interface SignUpDeps {
  invites: InviteRepository;
  rules: SignUpRules;
  accounts: AccountRepository;
  /** Reads guild membership for Discord sign-ups; null when Discord is not configured. */
  discord: IdentityProvider | null;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
}

/** Who wants a new account: their characters (EVE sign-in) or Discord user, and an invite. */
export interface SignUpCandidate {
  characters?: ReadonlyArray<{ corporationId: number; allianceId: number | null }>;
  /** The Discord user's access token, to ask whether it is in one of the allowed servers. */
  discordAccessToken?: string;
  invite?: string | null;
}

const DAY = 24 * 60 * 60_000;

export const SIGN_UP_REFUSED =
  'New accounts need an invite on this instance. Ask an admin for an invite link.';

/**
 * Who may get a new account. Open by default. Restricted, a first sign-in creates an account
 * only for a character in an allowed corporation or alliance, a member of an allowed Discord
 * server, or someone holding an invite link (Wanderer's invites). Existing accounts always sign
 * in (an admin disables them instead), and the very first account (the owner) is always made.
 */
export class SignUpGate {
  constructor(private readonly deps: SignUpDeps) {}

  /**
   * Throws unless the candidate may get an account. Returns the invite to count as used once the
   * account exists (null when another rule let them in).
   */
  async check(candidate: SignUpCandidate): Promise<{ inviteId: string | null }> {
    const policy = await this.deps.rules.signInPolicy();
    if (policy.mode === 'open' || (await this.deps.accounts.count()) === 0) return { inviteId: null };
    for (const c of candidate.characters ?? []) {
      if (policy.corporationIds.includes(c.corporationId)) return { inviteId: null };
      if (c.allianceId !== null && policy.allianceIds.includes(c.allianceId)) return { inviteId: null };
    }
    if (candidate.discordAccessToken && this.deps.discord) {
      for (const guildId of policy.guildIds) {
        const roles = await this.deps.discord
          .guildRoles(candidate.discordAccessToken, guildId)
          .catch(() => null);
        if (roles !== null) return { inviteId: null };
      }
    }
    if (candidate.invite) {
      const invite = await this.deps.invites.findByTokenHash(await sha256(candidate.invite));
      if (invite && active(invite, this.deps.clock.now())) return { inviteId: invite.id };
    }
    throw new ForbiddenError(SIGN_UP_REFUSED);
  }

  /** Counts the invite as used by the new account (in the account's transaction). */
  async used(inviteId: string | null, accountId: string): Promise<void> {
    if (!inviteId) return;
    if (!(await this.deps.invites.use(inviteId, this.deps.clock.now())))
      throw new ForbiddenError(SIGN_UP_REFUSED);
    await this.record({ kind: 'system', id: 'sign-up' }, 'invite.used', { id: inviteId, accountId });
  }

  // --- invites (instance admins) ----------------------------------------------------------------

  async listInvites(actor: Actor | null): Promise<InviteDto[]> {
    requireInstanceRole(actor, 'admin');
    const now = this.deps.clock.now();
    return (await this.deps.invites.list()).map((i) => toInviteDto(i, now));
  }

  /** A new invite; its token (the link) is returned only now. */
  async createInvite(
    actor: Actor | null,
    request: CreateInviteRequest,
  ): Promise<{ invite: InviteDto; token: string }> {
    const admin = requireInstanceRole(actor, 'admin');
    const now = this.deps.clock.now();
    const token = randomToken(24);
    const invite: Invite = {
      id: newId(),
      tokenHash: await sha256(token),
      note: request.note || null,
      createdBy: admin.id,
      createdAt: now,
      expiresAt: request.expiresInDays === null ? null : now + request.expiresInDays * DAY,
      maxUses: request.maxUses,
      uses: 0,
      revokedAt: null,
    };
    await this.deps.uow.transaction(async () => {
      await this.deps.invites.insert(invite);
      await this.record(actorRef(admin), 'invite.created', {
        id: invite.id,
        note: invite.note,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
      });
    });
    return { invite: toInviteDto(invite, now), token };
  }

  async revokeInvite(actor: Actor | null, inviteId: string): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    await this.deps.uow.transaction(async () => {
      const invite = await this.deps.invites.findById(inviteId);
      if (!invite) throw new NotFoundError('Invite');
      if (invite.revokedAt !== null) return;
      await this.deps.invites.update({ ...invite, revokedAt: this.deps.clock.now() });
      await this.record(actorRef(admin), 'invite.revoked', { id: inviteId });
    });
  }

  private async record<K extends 'invite.created' | 'invite.revoked' | 'invite.used'>(
    actor: ActorRef,
    type: K,
    data: AuditEventPayloads[K],
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type,
        actor,
        data,
        occurredAt: this.deps.clock.now(),
      }),
    ]);
  }
}

function active(invite: Invite, now: number): boolean {
  return (
    invite.revokedAt === null &&
    (invite.expiresAt === null || invite.expiresAt > now) &&
    (invite.maxUses === null || invite.uses < invite.maxUses)
  );
}

export function toInviteDto(invite: Invite, now: number): InviteDto {
  return {
    id: invite.id,
    note: invite.note,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    uses: invite.uses,
    revokedAt: invite.revokedAt,
    active: active(invite, now),
  };
}
