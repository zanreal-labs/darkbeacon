import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_STREAM, newEvent, type ActorRef, type Clock, type EventLog } from '@darkbeacon/core';
import type { AuditEventPayloads, SignInProvider } from '@darkbeacon/shared';
import { CLOCK, EVENT_LOG } from '../../platform/tokens.js';

/** Who records a failed sign-in: nobody is signed in yet. */
const SIGN_IN: ActorRef = { kind: 'system', id: 'sign-in' };

/**
 * Sign-ins (successful or not), sign-outs, Discord connections and the instance bot on the audit
 * stream. A failure to record is logged,
 * never shown to the person signing in.
 */
@Injectable()
export class SignInAudit {
  private readonly logger = new Logger('Audit');

  constructor(
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  signedIn(accountId: string, provider: SignInProvider): Promise<void> {
    return this.record({ kind: 'account', id: accountId }, 'auth.signed_in', { accountId, provider });
  }

  failed(provider: SignInProvider, reason: string): Promise<void> {
    return this.record(SIGN_IN, 'auth.sign_in_failed', {
      provider,
      reason: reason.slice(0, 200),
      accountId: null,
    });
  }

  signedOut(accountId: string, everywhere: boolean, device?: string | null): Promise<void> {
    return this.record({ kind: 'account', id: accountId }, 'auth.signed_out', {
      accountId,
      everywhere,
      ...(device !== undefined ? { device } : {}),
    });
  }

  discordChanged(accountId: string, connected: boolean): Promise<void> {
    return this.record({ kind: 'account', id: accountId }, 'account.discord_changed', {
      accountId,
      connected,
    });
  }

  /** The instance bot, as an update with what it was before. */
  botChanged(
    actor: ActorRef,
    before: AuditEventPayloads['discord_bot.changed'],
    after: AuditEventPayloads['discord_bot.changed'],
  ): Promise<void> {
    return this.record(actor, 'discord_bot.changed', after, before);
  }

  private async record<K extends keyof AuditEventPayloads>(
    actor: ActorRef,
    type: K,
    data: AuditEventPayloads[K],
    before?: AuditEventPayloads[K],
  ): Promise<void> {
    try {
      await this.log.append([
        newEvent({
          stream: AUDIT_STREAM,
          type,
          actor,
          data,
          occurredAt: this.clock.now(),
          ...(before !== undefined ? { before } : {}),
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `could not record ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
