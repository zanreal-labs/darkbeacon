import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_STREAM, newEvent, type ActorRef, type Clock, type EventLog } from '@darkbeacon/core';
import type { AuditEventPayloads, SignInProvider } from '@darkbeacon/shared';
import { CLOCK, EVENT_LOG } from '../../platform/tokens.js';

/** Who records a failed sign-in: nobody is signed in yet. */
const SIGN_IN: ActorRef = { kind: 'system', id: 'sign-in' };

/**
 * Sign-ins (successful or not) and sign-outs on the audit stream. A failure to record is logged,
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

  signedOut(accountId: string, everywhere: boolean): Promise<void> {
    return this.record({ kind: 'account', id: accountId }, 'auth.signed_out', { accountId, everywhere });
  }

  private async record<K extends 'auth.signed_in' | 'auth.sign_in_failed' | 'auth.signed_out'>(
    actor: ActorRef,
    type: K,
    data: AuditEventPayloads[K],
  ): Promise<void> {
    try {
      await this.log.append([
        newEvent({ stream: AUDIT_STREAM, type, actor, data, occurredAt: this.clock.now() }),
      ]);
    } catch (error) {
      this.logger.error(
        `could not record ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
