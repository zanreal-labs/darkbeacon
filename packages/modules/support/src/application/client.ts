import { requireAccount, ValidationError, type Actor, type Clock } from '@darkbeacon/core';
import type { SaveSupportHandleRequest, SupportClientDto } from '@darkbeacon/shared';
import type { ClientHandleStore } from '../ports/index.js';

export interface SupportClientConfig {
  /** The hub's origin; null when support is off here (`SUPPORT_HUB_URL=off`). */
  hubUrl: string | null;
  /** This instance is the hub. */
  inApp: boolean;
  /** The hub here keeps tickets itself. */
  localInbox: boolean;
  instance: Omit<SupportClientDto['instance'], 'loginMethod'>;
}

/**
 * Every instance's side of support: where the help menu's entries go, the few facts about the
 * instance a ticket may carry, and the unread handle the hub gave each account.
 */
export class SupportClientService {
  constructor(
    private readonly deps: {
      config: SupportClientConfig;
      handles: ClientHandleStore;
      loginMethod: () => Promise<'discord' | 'eve'>;
      clock: Clock;
    },
  ) {}

  async client(actor: Actor | null): Promise<SupportClientDto> {
    const { config } = this.deps;
    const stored =
      actor?.kind === 'account' && config.hubUrl && !config.inApp
        ? await this.deps.handles.get(actor.id)
        : null;
    return {
      hubUrl: config.hubUrl,
      inApp: config.inApp,
      // A handle for another hub (the setting changed) is of no use.
      handle: stored && stored.hubOrigin === config.hubUrl ? stored.handle : null,
      instance: { ...config.instance, loginMethod: await this.deps.loginMethod() },
      localInbox: config.localInbox,
    };
  }

  async saveHandle(actor: Actor | null, request: SaveSupportHandleRequest): Promise<void> {
    const account = requireAccount(actor);
    if (!this.deps.config.hubUrl || request.hubOrigin !== this.deps.config.hubUrl)
      throw new ValidationError('That is not this instance’s support hub');
    await this.deps.handles.set(account.id, request, this.deps.clock.now());
  }

  async forgetHandle(actor: Actor | null): Promise<void> {
    await this.deps.handles.clear(requireAccount(actor).id);
  }
}
