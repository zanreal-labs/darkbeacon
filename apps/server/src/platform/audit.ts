import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { AuditDirectory } from '@darkbeacon/audit';
import { grantOf, type Actor, type AuditContext, type AuditOrigin, type AuditScope } from '@darkbeacon/core';
import { Observable } from 'rxjs';
import type { RequestLike } from './actor.js';

/** AuditScope over AsyncLocalStorage: facts follow the async work of one request or job. */
@Injectable()
export class AsyncAuditScope implements AuditScope {
  private readonly storage = new AsyncLocalStorage<AuditContext>();

  run<T>(context: AuditContext, work: () => Promise<T>): Promise<T> {
    return this.storage.run({ ...this.current(), ...context }, work);
  }

  /** Like `run` for work that is not a promise (a Nest handler observable is subscribed in it). */
  enter<T>(context: AuditContext, work: () => T): T {
    return this.storage.run({ ...this.current(), ...context }, work);
  }

  current(): AuditContext {
    return this.storage.getStore() ?? {};
  }

  /** Runs `work` with no audit facts at all (event handlers, background jobs). */
  detached<T>(work: () => T): T {
    return this.storage.exit(work);
  }
}

/**
 * The AuditDirectory the event log asks for names. The identity module installs the real one
 * (`use`) in `onModuleInit`; until then nobody has a name. Names are read when an event is
 * written (two primary-key reads per batch at most), so a rename or a new main character shows
 * from the next change on.
 */
@Injectable()
export class AuditDirectoryRegistry implements AuditDirectory {
  private directory: AuditDirectory | null = null;

  use(directory: AuditDirectory): void {
    this.directory = directory;
  }

  account(accountId: string): ReturnType<AuditDirectory['account']> {
    return this.directory?.account(accountId) ?? Promise.resolve(null);
  }

  character(characterId: number): ReturnType<AuditDirectory['character']> {
    return this.directory?.character(characterId) ?? Promise.resolve(null);
  }
}

/**
 * Country headers set by common proxies and CDNs in front of the server. They are only as
 * trustworthy as that proxy (a client reaching the server directly can send any of them).
 */
const COUNTRY_HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-vercel-ip-country'];
const MAX_USER_AGENT = 300;

function header(request: RequestLike, name: string): string | null {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : null;
}

/** Country and user agent of a request, as recorded with the changes it makes. */
export function requestOrigin(request: RequestLike): AuditOrigin {
  let country: string | null = null;
  for (const name of COUNTRY_HEADERS) {
    const value = header(request, name)?.toUpperCase();
    // Cloudflare answers XX for unknown and T1 for Tor.
    if (value && /^[A-Z][A-Z0-9]$/.test(value) && value !== 'XX') {
      country = value;
      break;
    }
  }
  const agent = header(request, 'user-agent');
  return { country, userAgent: agent ? agent.slice(0, MAX_USER_AGENT) : null };
}

/** The header a client names one gesture with, so all of its changes can be undone together. */
export const ACTION_HEADER = 'x-darkbeacon-action';
const ACTION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The gesture a request belongs to, when the client named one in a usable form. */
export function requestAction(request: RequestLike): string | undefined {
  const value = header(request, ACTION_HEADER);
  return value && ACTION_ID.test(value) ? value : undefined;
}

/** The audit facts of an HTTP request made by `actor`. */
export function requestContext(request: RequestLike, actor: Actor | null): AuditContext {
  const origin = requestOrigin(request);
  const action = requestAction(request);
  const extra = action ? { action } : {};
  const grant = grantOf(actor);
  // "via key <name>": the key and its name as they were, over the REST API or the MCP endpoint.
  if (grant)
    return { channel: { kind: grant.channel, id: grant.credentialId, name: grant.name }, origin, ...extra };
  if (actor?.kind === 'plugin') return { channel: { kind: 'plugin', id: actor.id }, origin, ...extra };
  return { channel: { kind: 'web' }, origin, ...extra };
}

/**
 * Global interceptor: every HTTP handler runs inside an audit scope with the request's channel
 * and origin, so events appended anywhere below record them. Runs after the actor guard.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(@Inject(AsyncAuditScope) private readonly scope: AsyncAuditScope) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<RequestLike & { actor?: Actor | null }>();
    const audit = requestContext(request, request.actor ?? null);
    // Subscribing inside the scope runs the handler (and all its awaits) inside it.
    return new Observable((subscriber) => this.scope.enter(audit, () => next.handle().subscribe(subscriber)));
  }
}
