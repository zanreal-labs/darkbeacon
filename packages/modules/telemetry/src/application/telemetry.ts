import {
  AUDIT_STREAM,
  actorRef,
  isInstanceAdmin,
  newEvent,
  newId,
  requireAccount,
  requireInstanceRole,
  ValidationError,
  type Actor,
  type AuditContext,
  type Clock,
  type EventLog,
} from '@darkbeacon/core';
import type {
  TelemetryClientDto,
  TelemetryIngestRequest,
  TelemetryOffReason,
  TelemetryPayloadDto,
  TelemetryStatusDto,
} from '@darkbeacon/shared';
import { TELEMETRY_WEB_EVENTS } from '@darkbeacon/shared';
import type { ZodType } from 'zod';
import { TELEMETRY_SERVER_EVENTS, validateTelemetryEvent, type HeartbeatProps } from '../domain/catalogue.js';
import { featureEvents, type ObservedEvent } from '../domain/features.js';
import { telemetryOffReason, type TelemetryEnvironment } from '../domain/policy.js';
import { pseudonymousId, type HmacSha256 } from '../domain/pseudonym.js';
import { requestFeature, type ObservedRequest } from '../domain/requests.js';
import type {
  OutgoingTelemetryEvent,
  TelemetryMetrics,
  TelemetrySink,
  TelemetryStateStore,
} from '../ports/index.js';
import { MinuteCap, Ring } from './limits.js';

export interface TelemetryConfig {
  environment: TelemetryEnvironment;
  /** PostHog ingestion host, shown on the admin card. */
  host: string;
  appVersion: string;
  demo: boolean;
  nodeMajor: number;
  discordLogin: boolean;
  eveSso: boolean;
}

export interface TelemetryDeps {
  sink: TelemetrySink;
  state: TelemetryStateStore;
  metrics: TelemetryMetrics;
  /** The admin switch is recorded on the instance audit. */
  events: EventLog;
  clock: Clock;
  /** For the pseudonymous account ids. */
  hmac: HmacSha256;
  config: TelemetryConfig;
  /** Hard cap per instance and minute; more is dropped (default 300). */
  perMinute?: number;
  /** Payloads kept for the admin preview (default 50). */
  recent?: number;
  /** Told about events that failed the allow-list (a bug: they are dropped). */
  onRejected?(problem: string): void;
}

const SERVER_CATALOGUE = TELEMETRY_SERVER_EVENTS as Readonly<Record<string, ZodType>>;
const WEB_CATALOGUE = TELEMETRY_WEB_EVENTS as Readonly<Record<string, ZodType>>;
/** Reverts remembered to count each once, though one revert writes several events. */
const REVERTS_KEPT = 200;

/**
 * Anonymous product telemetry. Everything goes through `send`: the allow-list, the opt-outs,
 * the per-minute cap, pseudonymous ids and the fixed super-properties; the sink only ever sees
 * what passed. Nothing here waits on the network or throws into a request.
 */
export class TelemetryService {
  private identity: { instanceId: string; secret: string } | null = null;
  private adminEnabled = true;
  private readonly cap: MinuteCap;
  private readonly ring: Ring<TelemetryPayloadDto>;
  private readonly reverts = new Set<string>();
  private dropped = 0;
  private onlinePeak = 0;

  constructor(private readonly deps: TelemetryDeps) {
    this.cap = new MinuteCap(deps.perMinute ?? 300);
    this.ring = new Ring(deps.recent ?? 50);
  }

  /** Loads the instance identity and the admin switch; nothing is sent before. */
  async start(): Promise<void> {
    this.identity = await this.deps.state.identity();
    this.adminEnabled = (await this.deps.state.adminEnabled()) ?? true;
  }

  get offReason(): TelemetryOffReason | null {
    return telemetryOffReason(this.deps.config.environment, this.adminEnabled);
  }

  get active(): boolean {
    return this.identity !== null && this.offReason === null;
  }

  /** A server-side event from the catalogue, by the account behind it (if any). */
  track(event: string, props: Record<string, unknown>, accountId: string | null = null): boolean {
    return this.send(event, props, accountId, 'server', SERVER_CATALOGUE);
  }

  /** Domain events, as committed by the event log (with `before` and the audit facts). */
  observe(event: ObservedEvent, context: AuditContext): void {
    if (!this.active) return;
    if (context.revertOf) {
      if (this.reverts.has(context.revertOf)) return;
      this.reverts.add(context.revertOf);
      if (this.reverts.size > REVERTS_KEPT) this.reverts.delete(this.reverts.values().next().value!);
    }
    for (const feature of featureEvents(event, context))
      this.track(feature.event, feature.props, feature.accountId);
  }

  /** A successful API request on one of the observed routes. */
  observeRequest(request: ObservedRequest, accountId: string | null): void {
    if (!this.active) return;
    const feature = requestFeature(request);
    if (feature) this.track(feature.event, feature.props, accountId);
  }

  /**
   * Events from the web app. The whole batch is refused when any event is not on the list, so
   * a client cannot slip a property past it; accepted ones are sent like server events.
   */
  ingest(actor: Actor | null, request: TelemetryIngestRequest): { accepted: number } {
    const account = requireAccount(actor);
    const checked = request.events.map((e) => ({
      e,
      result: validateTelemetryEvent(e.event, e.props, WEB_CATALOGUE),
    }));
    const invalid = checked.find((c) => !c.result.ok);
    if (invalid && !invalid.result.ok) throw new ValidationError(invalid.result.problem);
    if (!this.active) return { accepted: 0 };
    let accepted = 0;
    for (const { e } of checked)
      if (this.send(e.event, e.props, account.id, 'web', WEB_CATALOGUE)) accepted++;
    return { accepted };
  }

  client(actor: Actor | null): Promise<TelemetryClientDto> {
    const account = requireAccount(actor);
    if (!this.active || !isInstanceAdmin(account))
      return Promise.resolve({ active: this.active, notice: false });
    return this.deps.state
      .noticeDismissed(account.id)
      .then((dismissed) => ({ active: true, notice: !dismissed }));
  }

  async dismissNotice(actor: Actor | null): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    await this.deps.state.dismissNotice(admin.id, this.deps.clock.now());
  }

  async status(actor: Actor | null): Promise<TelemetryStatusDto> {
    requireInstanceRole(actor, 'admin');
    const identity = this.identity ?? (await this.deps.state.identity());
    return {
      active: this.active,
      reason: this.offReason,
      instanceId: identity.instanceId,
      host: this.deps.config.host,
      keyConfigured: this.deps.config.environment.key !== '',
      adminEnabled: this.adminEnabled,
      dropped: this.dropped,
      recent: this.ring.newestFirst(),
      heartbeatPreview: this.payload(await this.heartbeat(), identity, null, 'server', 'instance_heartbeat'),
    };
  }

  /** The admin switch, recorded on the instance audit. */
  async setEnabled(actor: Actor | null, enabled: boolean): Promise<TelemetryStatusDto> {
    const admin = requireInstanceRole(actor, 'admin');
    const before = this.adminEnabled;
    await this.deps.state.setAdminEnabled(enabled);
    this.adminEnabled = enabled;
    if (before !== enabled) {
      await this.deps.events.append([
        newEvent({
          stream: AUDIT_STREAM,
          type: 'telemetry.changed',
          actor: actorRef(admin),
          data: { enabled },
          before: { enabled: before },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
    }
    return this.status(admin);
  }

  /** The heartbeat's properties as of now. */
  async heartbeat(): Promise<HeartbeatProps> {
    const { config } = this.deps;
    const metrics = await this.deps.metrics.collect(this.deps.clock.now());
    const online = await this.deps.metrics.onlineTrackedCharacters().catch(() => 0);
    return {
      ...metrics,
      node_major: config.nodeMajor,
      discord_login: config.discordLogin,
      eve_sso: config.eveSso,
      online_peak: Math.max(this.onlinePeak, online),
    };
  }

  /** Sends the daily heartbeat when one is due (`intervalMs` after the last one). */
  async heartbeatIfDue(intervalMs: number): Promise<boolean> {
    if (!this.active) return false;
    const now = this.deps.clock.now();
    const last = await this.deps.state.lastHeartbeatAt();
    if (last !== null && now - last < intervalMs) return false;
    const sent = this.track('instance_heartbeat', await this.heartbeat());
    if (sent) {
      await this.deps.state.setLastHeartbeatAt(now);
      this.onlinePeak = 0;
    }
    return sent;
  }

  /** Samples tracked characters online, for the peak in the next heartbeat. */
  async sampleOnline(): Promise<void> {
    if (!this.active) return;
    this.onlinePeak = Math.max(this.onlinePeak, await this.deps.metrics.onlineTrackedCharacters());
  }

  flush(): Promise<void> {
    return this.deps.sink.flush();
  }

  shutdown(timeoutMs = 5_000): Promise<void> {
    return this.deps.sink.shutdown(timeoutMs);
  }

  private send(
    event: string,
    props: Record<string, unknown>,
    accountId: string | null,
    origin: 'server' | 'web',
    catalogue: Readonly<Record<string, ZodType>>,
  ): boolean {
    const identity = this.identity;
    if (!identity || this.offReason !== null) return false;
    const checked = validateTelemetryEvent(event, props, catalogue);
    if (!checked.ok) {
      this.deps.onRejected?.(checked.problem);
      return false;
    }
    if (!this.cap.take(this.deps.clock.now())) {
      this.dropped++;
      return false;
    }
    const payload = this.payload(checked.props, identity, accountId, origin, event);
    this.ring.push(payload);
    const outgoing: OutgoingTelemetryEvent = {
      uuid: newId(),
      event: payload.event,
      distinctId: payload.distinctId,
      properties: payload.properties,
      timestamp: payload.at,
    };
    this.deps.sink.capture(outgoing);
    return true;
  }

  private payload(
    props: Record<string, unknown>,
    identity: { instanceId: string; secret: string },
    accountId: string | null,
    origin: 'server' | 'web',
    event: string,
  ): TelemetryPayloadDto {
    const { config } = this.deps;
    return {
      at: this.deps.clock.now(),
      event,
      distinctId: accountId
        ? pseudonymousId(this.deps.hmac, identity.secret, accountId)
        : identity.instanceId,
      properties: {
        ...props,
        instance_id: identity.instanceId,
        app_version: config.appVersion,
        demo: config.demo,
        origin,
        // Anonymous events: no person profiles, no GeoIP lookup, no IP kept.
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
      },
    };
  }
}
