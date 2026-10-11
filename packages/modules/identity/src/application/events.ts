import { INSTANCE_STREAM, newEvent, type ActorRef, type NewEvent } from '@wormwright/core';
import type { GuildRole } from '../domain/account.js';

/** Identity's own changes (token refresh, role sync) are recorded as this actor. */
export const IDENTITY_ACTOR: ActorRef = { kind: 'system', id: 'identity' };

/** `access.account_changed`: what the account is matched by, or its sessions, changed. */
export function accountChanged(accountId: string, actor: ActorRef, now: number): NewEvent {
  return newEvent({
    stream: INSTANCE_STREAM,
    type: 'access.account_changed',
    actor,
    data: { accountId },
    occurredAt: now,
  });
}

export function sameRoles(a: readonly GuildRole[], b: readonly GuildRole[]): boolean {
  const key = (roles: readonly GuildRole[]) =>
    roles
      .map((r) => `${r.guildId}/${r.roleId}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}
