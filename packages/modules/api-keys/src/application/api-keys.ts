import {
  AUDIT_STREAM,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  actorRef,
  grantOf as grantOfActor,
  hasMapRole,
  isInstanceAdmin,
  newEvent,
  newId,
  requireAccount,
  type AccountActor,
  type Actor,
  type CredentialGrant,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  isReservedScope,
  parseScope,
  scopesNeedAdmin,
  type ApiKeyAuditDto,
  type ApiKeyDto,
  type CreateApiKeyRequest,
  type CreatedApiKeyDto,
  type CreateServiceKeyRequest,
  type UpdateApiKeyRequest,
} from '@darkbeacon/shared';
import {
  keyStatus,
  personalActor,
  referencedMaps,
  refusal,
  serviceActor,
  type ApiKey,
} from '../domain/key.js';
import { LOOKUP_LENGTH, SECRET_LENGTH, displayPrefix, formatToken, parseToken } from '../domain/token.js';
import type { ApiKeyRepository, KeyOwnerDirectory, MapNames, TokenSecrets } from '../ports/index.js';

export interface ApiKeysDeps {
  keys: ApiKeyRepository;
  secrets: TokenSecrets;
  owners: KeyOwnerDirectory;
  maps: MapNames;
  /** The owner's map roles, to refuse scopes on maps the owner cannot see. */
  access: MapAccess;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
}

/** What a verified key resolves to. */
export interface AuthenticatedKey {
  actor: Actor;
  keyId: string;
  rateLimitPerMinute: number | null;
}

/** Last-used stamps are written at most this often per key (and whenever the address changes). */
const TOUCH_EVERY_MS = 60_000;

/**
 * API keys: personal access tokens (made by an account in its settings, acting as that account
 * and never more) and service keys (made by instance admins, with explicit roles). Managing keys
 * needs a browser session: a key never manages keys.
 */
export class ApiKeys {
  constructor(private readonly deps: ApiKeysDeps) {}

  // ---- personal access tokens ------------------------------------------------------------

  async listOwn(actor: Actor | null): Promise<ApiKeyDto[]> {
    const account = this.sessionAccount(actor);
    return this.toDtos(await this.deps.keys.listByOwner(account.id));
  }

  async createPersonal(actor: Actor | null, request: CreateApiKeyRequest): Promise<CreatedApiKeyDto> {
    const account = this.sessionAccount(actor);
    await this.checkScopes(account, request.scopes, request.readOnly);
    this.checkExpiry(request.expiresAt ?? null);
    return this.create(account, {
      kind: 'pat',
      name: request.name,
      scopes: request.scopes,
      readOnly: request.readOnly,
      expiresAt: request.expiresAt ?? null,
      allowedIps: request.allowedIps,
      rateLimitPerMinute: request.rateLimitPerMinute ?? null,
      ownerAccountId: account.id,
      instanceRole: null,
      mapGrants: [],
      allMapsRole: null,
    });
  }

  async updateOwn(actor: Actor | null, keyId: string, request: UpdateApiKeyRequest): Promise<ApiKeyDto> {
    const account = this.sessionAccount(actor);
    return this.update(account, await this.own(account, keyId), request);
  }

  async rotateOwn(actor: Actor | null, keyId: string): Promise<CreatedApiKeyDto> {
    const account = this.sessionAccount(actor);
    return this.rotate(account, await this.own(account, keyId));
  }

  async revokeOwn(actor: Actor | null, keyId: string): Promise<void> {
    const account = this.sessionAccount(actor);
    await this.revoke(account, await this.own(account, keyId));
  }

  // ---- service keys and every key (instance admins) ---------------------------------------

  async listAll(actor: Actor | null): Promise<ApiKeyDto[]> {
    this.sessionAdmin(actor);
    return this.toDtos(await this.deps.keys.listAll());
  }

  async createService(actor: Actor | null, request: CreateServiceKeyRequest): Promise<CreatedApiKeyDto> {
    const admin = this.sessionAdmin(actor);
    for (const scope of request.scopes) this.checkScopeSyntax(scope);
    if (scopesNeedAdmin(request.scopes) && request.instanceRole !== 'admin')
      throw new ValidationError('admin: scopes need the admin instance role');
    const grants = new Map(request.mapGrants.map((g) => [g.mapId, g.role]));
    const known = new Set((await this.deps.maps.describe([...grants.keys()])).map((m) => m.id));
    for (const mapId of grants.keys()) if (!known.has(mapId)) throw new NotFoundError('Map');
    for (const scope of request.scopes) {
      const mapId = parseScope(scope)?.mapId;
      if (mapId && !grants.has(mapId) && request.allMapsRole === null)
        throw new ValidationError(`The scope ${scope} names a map the key has no role on`);
    }
    this.checkExpiry(request.expiresAt ?? null);
    return this.create(admin, {
      kind: 'svc',
      name: request.name,
      scopes: request.scopes,
      readOnly: request.readOnly,
      expiresAt: request.expiresAt ?? null,
      allowedIps: request.allowedIps,
      rateLimitPerMinute: request.rateLimitPerMinute ?? null,
      ownerAccountId: null,
      instanceRole: request.instanceRole,
      mapGrants: [...grants].map(([mapId, role]) => ({ mapId, role })),
      allMapsRole: request.allMapsRole,
    });
  }

  async updateService(actor: Actor | null, keyId: string, request: UpdateApiKeyRequest): Promise<ApiKeyDto> {
    const admin = this.sessionAdmin(actor);
    return this.update(admin, await this.service(keyId), request);
  }

  async rotateService(actor: Actor | null, keyId: string): Promise<CreatedApiKeyDto> {
    const admin = this.sessionAdmin(actor);
    return this.rotate(admin, await this.service(keyId));
  }

  /** Admins revoke any key, personal ones too (a leaked token, someone who left). */
  async revokeAny(actor: Actor | null, keyId: string): Promise<void> {
    const admin = this.sessionAdmin(actor);
    const key = await this.deps.keys.findById(keyId);
    if (!key) throw new NotFoundError('API key');
    await this.revoke(admin, key);
  }

  // ---- verification ------------------------------------------------------------------------

  /**
   * Verifies a bearer token and returns the actor it acts as. Unknown, malformed and wrong
   * tokens fail alike ("Invalid API key"); a known key says why it cannot be used.
   */
  async authenticate(
    token: string,
    context: { ip: string | null; channel: CredentialGrant['channel'] },
  ): Promise<AuthenticatedKey> {
    const parsed = parseToken(token);
    if (!parsed) throw new UnauthenticatedError('Invalid API key');
    const key = await this.deps.keys.findByLookup(parsed.lookup);
    // Hash anyway, so a miss takes as long as a wrong secret.
    const hash = this.deps.secrets.hash(parsed.secret);
    if (!key || key.kind !== parsed.kind || !this.deps.secrets.equals(hash, key.secretHash))
      throw new UnauthenticatedError('Invalid API key');
    const now = this.deps.clock.now();
    const refused = refusal(key, now, context.ip);
    if (refused) throw new UnauthenticatedError(refused);

    let actor: Actor;
    if (key.kind === 'pat') {
      const owner = key.ownerAccountId ? await this.deps.owners.find(key.ownerAccountId) : null;
      if (!owner) throw new UnauthenticatedError('Invalid API key');
      actor = personalActor(key, owner, context.channel);
    } else actor = serviceActor(key, context.channel);

    if (key.lastUsedAt === null || now - key.lastUsedAt >= TOUCH_EVERY_MS || key.lastUsedIp !== context.ip) {
      this.deps.keys.touch(key.id, now, context.ip).catch(() => {
        // Only bookkeeping; the request goes on.
      });
    }
    return { actor, keyId: key.id, rateLimitPerMinute: key.rateLimitPerMinute };
  }

  // ---- internals ---------------------------------------------------------------------------

  /** Keys are managed from a browser session only, never with another key. */
  private sessionAccount(actor: Actor | null): AccountActor {
    const account = requireAccount(actor);
    if (account.grant) throw new ForbiddenError('API keys are managed from the web app, not with an API key');
    return account;
  }

  private sessionAdmin(actor: Actor | null): AccountActor {
    const account = this.sessionAccount(actor);
    if (!isInstanceAdmin(account)) throw new ForbiddenError();
    return account;
  }

  private async own(account: AccountActor, keyId: string): Promise<ApiKey> {
    const key = await this.deps.keys.findById(keyId);
    if (!key || key.kind !== 'pat' || key.ownerAccountId !== account.id) throw new NotFoundError('API key');
    return key;
  }

  private async service(keyId: string): Promise<ApiKey> {
    const key = await this.deps.keys.findById(keyId);
    if (!key || key.kind !== 'svc') throw new NotFoundError('API key');
    return key;
  }

  private checkScopeSyntax(scope: string): void {
    if (!parseScope(scope)) throw new ValidationError(`Unknown scope ${scope}`);
    if (isReservedScope(scope))
      throw new ValidationError(`${scope} is reserved for instance-to-instance sharing`);
  }

  /**
   * A personal token can only narrow its owner: `admin:` scopes need an instance admin, and a
   * scope on one map needs the owner to reach that map with the role the scope could use.
   * The same narrowing is applied again on every request (roles change).
   */
  private async checkScopes(
    account: AccountActor,
    scopes: readonly string[],
    readOnly: boolean,
  ): Promise<void> {
    for (const scope of scopes) this.checkScopeSyntax(scope);
    if (scopesNeedAdmin(scopes) && !isInstanceAdmin(account))
      throw new ForbiddenError('Only instance admins can give a key admin: scopes');
    for (const scope of scopes) {
      const parsed = parseScope(scope)!;
      if (!parsed.mapId) continue;
      const role = await this.deps.access.roleOf(account, parsed.mapId);
      if (!hasMapRole(role, 'viewer')) throw new NotFoundError('Map');
      if (!readOnly && parsed.action !== 'read' && !hasMapRole(role, 'member'))
        throw new ForbiddenError(`You can only read on that map, so ${scope} would give the key nothing`);
    }
  }

  private checkExpiry(expiresAt: number | null): void {
    if (expiresAt !== null && expiresAt <= this.deps.clock.now())
      throw new ValidationError('The expiry date must be in the future');
  }

  private async create(
    by: AccountActor,
    fields: Omit<
      ApiKey,
      | 'id'
      | 'lookup'
      | 'secretHash'
      | 'createdBy'
      | 'createdAt'
      | 'rotatedAt'
      | 'lastUsedAt'
      | 'lastUsedIp'
      | 'revokedAt'
    >,
  ): Promise<CreatedApiKeyDto> {
    const lookup = this.deps.secrets.random(LOOKUP_LENGTH);
    const secret = this.deps.secrets.random(SECRET_LENGTH);
    const now = this.deps.clock.now();
    const key: ApiKey = {
      ...fields,
      id: newId(),
      lookup,
      secretHash: this.deps.secrets.hash(secret),
      createdBy: by.id,
      createdAt: now,
      rotatedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
    };
    await this.deps.uow.transaction(async () => {
      await this.deps.keys.insert(key);
      await this.audit(by, 'api_key.created', auditView(key));
    });
    const [dto] = await this.toDtos([key]);
    return { key: dto!, token: formatToken(key.kind, lookup, secret) };
  }

  private async update(by: AccountActor, key: ApiKey, request: UpdateApiKeyRequest): Promise<ApiKeyDto> {
    if (key.revokedAt !== null) throw new ValidationError('This key was revoked');
    const next: ApiKey = {
      ...key,
      name: request.name ?? key.name,
      allowedIps: request.allowedIps ?? key.allowedIps,
      rateLimitPerMinute:
        request.rateLimitPerMinute === undefined ? key.rateLimitPerMinute : request.rateLimitPerMinute,
    };
    if (JSON.stringify(auditView(next)) !== JSON.stringify(auditView(key))) {
      await this.deps.uow.transaction(async () => {
        await this.deps.keys.update(next);
        await this.audit(by, 'api_key.updated', auditView(next), auditView(key));
      });
    }
    const [dto] = await this.toDtos([next]);
    return dto!;
  }

  private async rotate(by: AccountActor, key: ApiKey): Promise<CreatedApiKeyDto> {
    if (key.revokedAt !== null) throw new ValidationError('This key was revoked; make a new one');
    const lookup = this.deps.secrets.random(LOOKUP_LENGTH);
    const secret = this.deps.secrets.random(SECRET_LENGTH);
    const next: ApiKey = {
      ...key,
      lookup,
      secretHash: this.deps.secrets.hash(secret),
      rotatedAt: this.deps.clock.now(),
    };
    await this.deps.uow.transaction(async () => {
      await this.deps.keys.update(next);
      await this.audit(by, 'api_key.rotated', {
        id: key.id,
        name: key.name,
        kind: key.kind,
        ownerAccountId: key.ownerAccountId,
      });
    });
    const [dto] = await this.toDtos([next]);
    return { key: dto!, token: formatToken(next.kind, lookup, secret) };
  }

  private async revoke(by: AccountActor, key: ApiKey): Promise<void> {
    if (key.revokedAt !== null) return;
    const next: ApiKey = { ...key, revokedAt: this.deps.clock.now() };
    await this.deps.uow.transaction(async () => {
      await this.deps.keys.update(next);
      await this.audit(
        by,
        'api_key.revoked',
        { id: key.id, name: key.name, kind: key.kind, ownerAccountId: key.ownerAccountId },
        auditView(key),
      );
    });
  }

  private async audit(by: Actor, type: string, data: unknown, before?: unknown): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type,
        actor: actorRef(by),
        data,
        occurredAt: this.deps.clock.now(),
        ...(before !== undefined ? { before } : {}),
      }),
    ]);
  }

  private async toDtos(keys: ApiKey[]): Promise<ApiKeyDto[]> {
    const now = this.deps.clock.now();
    const mapIds = [...new Set(keys.flatMap(referencedMaps))];
    const accountIds = [...new Set(keys.map((k) => k.createdBy))];
    const [maps, names] = await Promise.all([
      this.deps.maps.describe(mapIds),
      this.deps.owners.names(accountIds),
    ]);
    const mapById = new Map(maps.map((m) => [m.id, m]));
    return keys.map((key) => ({
      id: key.id,
      kind: key.kind,
      name: key.name,
      prefix: displayPrefix(key.kind, key.lookup),
      scopes: key.scopes,
      readOnly: key.readOnly,
      expiresAt: key.expiresAt,
      allowedIps: key.allowedIps,
      rateLimitPerMinute: key.rateLimitPerMinute,
      ownerAccountId: key.ownerAccountId,
      createdBy: { accountId: key.createdBy, name: names.get(key.createdBy) ?? null },
      instanceRole: key.instanceRole,
      mapGrants: key.mapGrants,
      allMapsRole: key.allMapsRole,
      maps: referencedMaps(key).flatMap((id) => mapById.get(id) ?? []),
      status: keyStatus(key, now),
      createdAt: key.createdAt,
      rotatedAt: key.rotatedAt,
      lastUsedAt: key.lastUsedAt,
      lastUsedIp: key.lastUsedIp,
      revokedAt: key.revokedAt,
    }));
  }
}

/** The audit trail's view of a key: no lookup, no hash. */
export function auditView(key: ApiKey): ApiKeyAuditDto {
  return {
    id: key.id,
    kind: key.kind,
    name: key.name,
    scopes: key.scopes,
    readOnly: key.readOnly,
    expiresAt: key.expiresAt,
    allowedIps: key.allowedIps,
    rateLimitPerMinute: key.rateLimitPerMinute,
    ownerAccountId: key.ownerAccountId,
    instanceRole: key.instanceRole,
    mapGrants: key.mapGrants,
    allMapsRole: key.allMapsRole,
  };
}

/** True when the actor came through an API key (for edges that must refuse keys). */
export function viaKey(actor: Actor | null): boolean {
  return grantOfActor(actor) !== null;
}
