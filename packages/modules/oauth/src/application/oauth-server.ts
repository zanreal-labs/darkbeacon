import {
  AUDIT_STREAM,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  actorRef,
  hasMapRole,
  newEvent,
  newId,
  requireAccount,
  type AccountActor,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  TOKEN_LOOKUP_LENGTH,
  TOKEN_PREFIX,
  TOKEN_SECRET_LENGTH,
  formatSecretToken,
  parseScope,
  parseSecretToken,
  scopeRoleCaps,
  type OAuthAuthorizeDecision,
  type OAuthAuthorizeQuery,
  type OAuthAuthorizeRequestDto,
  type OAuthGrantDto,
  type OAuthRegisteredClientDto,
  type OAuthRegisterRequest,
  type OAuthTokenRequest,
  type OAuthTokenResponse,
} from '@darkbeacon/shared';
import {
  ACCESS_TTL_MS,
  CLIENT_METADATA_TTL_MS,
  CODE_TTL_MS,
  DEFAULT_OAUTH_SCOPES,
  REFRESH_TTL_MS,
  narrowToMaps,
  parseScopeParam,
  redirectAllowed,
  resourceMatches,
  validRedirectUri,
  withoutAdmin,
  type OAuthClient,
  type OAuthGrant,
  type TokenKind,
} from '../domain/oauth.js';
import type {
  ClientMetadataFetcher,
  OAuthAccounts,
  OAuthMapNames,
  OAuthSecrets,
  OAuthStore,
} from '../ports/index.js';

/** An error of the OAuth protocol itself, answered as `{ error, error_description }` (RFC 6749 5.2). */
export class OAuthProtocolError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
    this.name = 'OAuthProtocolError';
  }
}

export interface OAuthServerDeps {
  store: OAuthStore;
  secrets: OAuthSecrets;
  metadata: ClientMetadataFetcher;
  accounts: OAuthAccounts;
  maps: OAuthMapNames;
  access: MapAccess;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
  /** The instance's public URL: the issuer, and `<publicUrl>/mcp` the resource. */
  publicUrl: string;
}

/** What a verified access token resolves to. */
export interface AuthenticatedGrant {
  actor: Actor;
  grantId: string;
}

const isUrlClientId = (id: string) => id.startsWith('https://');

/**
 * Darkbeacon as the OAuth 2.1 authorization server of its own MCP endpoint: clients identify with
 * a Client ID Metadata Document (preferred) or register dynamically; a signed-in person approves
 * them on the consent page (and may narrow the scopes); codes are single use, short-lived and bound
 * to the PKCE challenge, the redirect URI and the resource; access tokens last an hour, refresh
 * tokens rotate and a replayed one revokes the whole approval. Tokens act as the person, narrowed
 * by the approved scopes, like a personal access token, and only on `/mcp`.
 */
export class OAuthServer {
  constructor(private readonly deps: OAuthServerDeps) {}

  get issuer(): string {
    return this.deps.publicUrl;
  }

  get resource(): string {
    return `${this.deps.publicUrl}/mcp`;
  }

  // ---- clients -----------------------------------------------------------------------------

  /** RFC 7591 dynamic registration, public clients only (no client secrets). */
  async register(request: OAuthRegisterRequest): Promise<OAuthRegisteredClientDto> {
    if (request.token_endpoint_auth_method && request.token_endpoint_auth_method !== 'none')
      throw new OAuthProtocolError(
        'invalid_client_metadata',
        'Only public clients (token_endpoint_auth_method none)',
      );
    const bad = request.redirect_uris.find((u) => !validRedirectUri(u));
    if (bad) throw new OAuthProtocolError('invalid_redirect_uri', `Not an allowed redirect URI: ${bad}`);
    const now = this.deps.clock.now();
    const client: OAuthClient = {
      id: `dbk_client_${this.deps.secrets.random(24)}`,
      kind: 'registered',
      name: (request.client_name ?? '').trim() || new URL(request.redirect_uris[0]!).host || 'An MCP client',
      uri: request.client_uri && /^https:\/\//.test(request.client_uri) ? request.client_uri : null,
      redirectUris: request.redirect_uris,
      createdAt: now,
      fetchedAt: now,
    };
    await this.deps.store.saveClient(client);
    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  /** The client behind an id: a registered one, or the metadata document at its URL. */
  private async client(clientId: string): Promise<OAuthClient> {
    const known = await this.deps.store.findClient(clientId);
    const now = this.deps.clock.now();
    if (known && (known.kind === 'registered' || now - known.fetchedAt < CLIENT_METADATA_TTL_MS))
      return known;
    if (!isUrlClientId(clientId)) throw new ValidationError('Unknown client');
    let document: unknown;
    try {
      document = await this.deps.metadata.fetch(clientId);
    } catch (error) {
      throw new ValidationError(
        `The client's metadata could not be read: ${error instanceof Error ? error.message : 'error'}`,
      );
    }
    const doc = (document ?? {}) as Record<string, unknown>;
    // The document must name itself (draft-ietf-oauth-client-id-metadata-document, 4.1).
    if (doc.client_id !== clientId)
      throw new ValidationError('The client metadata does not name this client');
    const redirectUris = Array.isArray(doc.redirect_uris)
      ? doc.redirect_uris.filter((u): u is string => typeof u === 'string')
      : [];
    if (redirectUris.length === 0 || redirectUris.some((u) => !validRedirectUri(u)))
      throw new ValidationError('The client metadata has no valid redirect_uris');
    if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none')
      throw new ValidationError('Only public clients are supported');
    const client: OAuthClient = {
      id: clientId,
      kind: 'metadata',
      name:
        typeof doc.client_name === 'string' && doc.client_name.trim()
          ? doc.client_name.trim().slice(0, 100)
          : new URL(clientId).host,
      uri:
        typeof doc.client_uri === 'string' && doc.client_uri.startsWith('https://') ? doc.client_uri : null,
      redirectUris,
      createdAt: known?.createdAt ?? now,
      fetchedAt: now,
    };
    await this.deps.store.saveClient(client);
    return client;
  }

  // ---- authorization (the consent page) ------------------------------------------------------

  /** Checks an authorization request and says what the consent page shows. */
  async describe(actor: Actor | null, query: OAuthAuthorizeQuery): Promise<OAuthAuthorizeRequestDto> {
    this.sessionAccount(actor);
    const { client, scopes } = await this.checkRequest(query);
    return {
      client: { id: client.id, name: client.name, kind: client.kind, uri: client.uri },
      redirectHost: new URL(query.redirect_uri).host,
      scopes,
      resource: this.resource,
    };
  }

  /**
   * The person's decision: a code (approved) or `access_denied`, as the URL the browser goes to.
   * Problems with the client or its redirect URI are thrown, never sent to that URI.
   */
  async decide(actor: Actor | null, decision: OAuthAuthorizeDecision): Promise<string> {
    const account = this.sessionAccount(actor);
    const { client, scopes } = await this.checkRequest(decision);
    const back = new URL(decision.redirect_uri);
    const answer = (params: Record<string, string>) => {
      for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
      if (decision.state !== undefined) back.searchParams.set('state', decision.state);
      back.searchParams.set('iss', this.issuer);
      return back.toString();
    };
    if (!decision.approve)
      return answer({ error: 'access_denied', error_description: 'The person declined' });

    const approved = narrowToMaps(scopes, decision.maps);
    if (approved.length === 0) throw new ValidationError('Pick at least one map');
    await this.checkOwnerRights(account, approved, decision.readOnly);
    const now = this.deps.clock.now();
    const grant: OAuthGrant = {
      id: newId(),
      accountId: account.id,
      clientId: client.id,
      clientName: client.name,
      clientUri: client.uri,
      scopes: approved,
      readOnly: decision.readOnly,
      resource: this.resource,
      createdAt: now,
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
    };
    const lookup = this.deps.secrets.random(TOKEN_LOOKUP_LENGTH);
    const secret = this.deps.secrets.random(TOKEN_SECRET_LENGTH);
    await this.deps.uow.transaction(async () => {
      await this.deps.store.insertGrant(grant);
      await this.deps.store.insertCode({
        lookup,
        secretHash: this.deps.secrets.hash(secret),
        grantId: grant.id,
        clientId: client.id,
        redirectUri: decision.redirect_uri,
        codeChallenge: decision.code_challenge,
        resource: this.resource,
        expiresAt: now + CODE_TTL_MS,
        usedAt: null,
      });
      await this.audit(account, 'oauth.grant_created', this.auditView(grant));
    });
    return answer({ code: `${lookup}${secret}` });
  }

  private async checkRequest(query: OAuthAuthorizeQuery): Promise<{ client: OAuthClient; scopes: string[] }> {
    const client = await this.client(query.client_id);
    if (!redirectAllowed(client.redirectUris, query.redirect_uri))
      throw new ValidationError('The redirect URI is not registered for this client');
    if (query.response_type !== 'code') throw new ValidationError('Only response_type=code is supported');
    if (query.code_challenge_method !== 'S256') throw new ValidationError('PKCE with S256 is required');
    if (!resourceMatches(query.resource, this.deps.publicUrl))
      throw new ValidationError(`This server only issues tokens for ${this.resource}`);
    const { scopes, invalid } = parseScopeParam(query.scope);
    if (invalid.length > 0) throw new ValidationError(`Unknown scopes: ${invalid.join(' ')}`);
    const asked = withoutAdmin(scopes.length > 0 ? scopes : DEFAULT_OAUTH_SCOPES);
    if (asked.length === 0) throw new ValidationError('Administration scopes are not granted to MCP clients');
    return { client, scopes: asked };
  }

  /** Like a personal access token: scopes on a map need the person to reach that map. */
  private async checkOwnerRights(
    account: AccountActor,
    scopes: readonly string[],
    readOnly: boolean,
  ): Promise<void> {
    for (const raw of scopes) {
      const scope = parseScope(raw)!;
      if (!scope.mapId) continue;
      const role = await this.deps.access.roleOf(account, scope.mapId);
      if (!hasMapRole(role, 'viewer')) throw new NotFoundError('Map');
      if (!readOnly && scope.action !== 'read' && !hasMapRole(role, 'member'))
        throw new ForbiddenError('You can only read on one of those maps; approve it read-only');
    }
  }

  // ---- the token endpoint ------------------------------------------------------------------

  async token(request: OAuthTokenRequest): Promise<OAuthTokenResponse> {
    if (request.grant_type === 'authorization_code') return this.exchangeCode(request);
    if (request.grant_type === 'refresh_token') return this.refresh(request);
    throw new OAuthProtocolError('unsupported_grant_type', 'authorization_code or refresh_token');
  }

  private async exchangeCode(request: OAuthTokenRequest): Promise<OAuthTokenResponse> {
    const invalid = (why: string) => new OAuthProtocolError('invalid_grant', why);
    if (!request.code || !request.code_verifier || !request.client_id || !request.redirect_uri)
      throw new OAuthProtocolError(
        'invalid_request',
        'code, code_verifier, client_id and redirect_uri are required',
      );
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(request.code_verifier)) throw invalid('Malformed code_verifier');
    const lookup = request.code.slice(0, TOKEN_LOOKUP_LENGTH);
    const secret = request.code.slice(TOKEN_LOOKUP_LENGTH);
    const code = await this.deps.store.findCode(lookup);
    const hash = this.deps.secrets.hash(secret);
    if (!code || !this.deps.secrets.equals(hash, code.secretHash)) throw invalid('Unknown code');
    const now = this.deps.clock.now();
    if (code.usedAt !== null || !(await this.deps.store.useCode(lookup, now))) {
      // A code used twice was stolen or replayed: the approval goes (RFC 6749 4.1.2).
      await this.revokeGrantById(code.grantId);
      throw invalid('The code was already used');
    }
    if (code.expiresAt <= now) throw invalid('The code expired');
    if (code.clientId !== request.client_id || code.redirectUri !== request.redirect_uri)
      throw invalid('The code was issued to another client or redirect URI');
    if (!this.deps.secrets.equals(this.deps.secrets.s256(request.code_verifier), code.codeChallenge))
      throw invalid('The code_verifier does not match the code_challenge');
    if (!resourceMatches(request.resource, this.deps.publicUrl))
      throw new OAuthProtocolError('invalid_target', 'Unknown resource');
    const grant = await this.liveGrant(code.grantId);
    return this.issue(grant);
  }

  private async refresh(request: OAuthTokenRequest): Promise<OAuthTokenResponse> {
    const invalid = (why: string) => new OAuthProtocolError('invalid_grant', why);
    const parsed = request.refresh_token
      ? parseSecretToken(request.refresh_token, [TOKEN_PREFIX.oauthRefresh])
      : null;
    if (!parsed) throw invalid('Unknown refresh token');
    const token = await this.deps.store.findToken(parsed.lookup, 'refresh');
    if (!token || !this.deps.secrets.equals(this.deps.secrets.hash(parsed.secret), token.secretHash))
      throw invalid('Unknown refresh token');
    const now = this.deps.clock.now();
    if (token.usedAt !== null || !(await this.deps.store.useToken(parsed.lookup, now))) {
      // Rotation: a refresh token used twice means two holders; end the approval.
      await this.revokeGrantById(token.grantId);
      throw invalid('The refresh token was already used');
    }
    if (token.expiresAt <= now) throw invalid('The refresh token expired');
    const grant = await this.liveGrant(token.grantId);
    if (request.client_id && request.client_id !== grant.clientId) throw invalid('Another client');
    if (!resourceMatches(request.resource, this.deps.publicUrl))
      throw new OAuthProtocolError('invalid_target', 'Unknown resource');
    return this.issue(grant);
  }

  private async liveGrant(grantId: string): Promise<OAuthGrant> {
    const grant = await this.deps.store.findGrant(grantId);
    if (!grant || grant.revokedAt !== null)
      throw new OAuthProtocolError('invalid_grant', 'The approval was revoked');
    return grant;
  }

  private async issue(grant: OAuthGrant): Promise<OAuthTokenResponse> {
    const now = this.deps.clock.now();
    const make = async (kind: TokenKind) => {
      const lookup = this.deps.secrets.random(TOKEN_LOOKUP_LENGTH);
      const secret = this.deps.secrets.random(TOKEN_SECRET_LENGTH);
      await this.deps.store.insertToken({
        lookup,
        secretHash: this.deps.secrets.hash(secret),
        kind,
        grantId: grant.id,
        createdAt: now,
        expiresAt: now + (kind === 'access' ? ACCESS_TTL_MS : REFRESH_TTL_MS),
        usedAt: null,
      });
      return formatSecretToken(
        kind === 'access' ? TOKEN_PREFIX.oauthAccess : TOKEN_PREFIX.oauthRefresh,
        lookup,
        secret,
      );
    };
    const access = await make('access');
    const refresh = await make('refresh');
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refresh,
      scope: grant.scopes.join(' '),
    };
  }

  // ---- using a token -------------------------------------------------------------------------

  /**
   * Verifies an access token on the MCP endpoint: the person, re-read now, narrowed by the approved
   * scopes. Tokens are bound to `/mcp` (their audience); anywhere else they are refused.
   */
  async authenticate(
    token: string,
    context: { ip: string | null; mcp: boolean },
  ): Promise<AuthenticatedGrant> {
    const parsed = parseSecretToken(token, [TOKEN_PREFIX.oauthAccess]);
    if (!parsed) throw new UnauthenticatedError('Invalid access token');
    const stored = await this.deps.store.findToken(parsed.lookup, 'access');
    const hash = this.deps.secrets.hash(parsed.secret);
    if (!stored || !this.deps.secrets.equals(hash, stored.secretHash))
      throw new UnauthenticatedError('Invalid access token');
    const now = this.deps.clock.now();
    if (stored.expiresAt <= now) throw new UnauthenticatedError('The access token expired');
    if (!context.mcp) throw new UnauthenticatedError('This access token is for the MCP endpoint only');
    const grant = await this.deps.store.findGrant(stored.grantId);
    if (!grant || grant.revokedAt !== null) throw new UnauthenticatedError('The approval was revoked');
    const owner = await this.deps.accounts.find(grant.accountId);
    if (!owner) throw new UnauthenticatedError('Invalid access token');
    if (grant.lastUsedAt === null || now - grant.lastUsedAt >= 60_000 || grant.lastUsedIp !== context.ip) {
      this.deps.store.touchGrant(grant.id, now, context.ip).catch(() => {});
    }
    const caps = scopeRoleCaps(grant.scopes, grant.readOnly);
    return {
      grantId: grant.id,
      actor: {
        kind: 'account',
        id: owner.id,
        // Administration is never granted through OAuth.
        instanceRole: 'user',
        grant: {
          credentialId: grant.id,
          name: grant.clientName,
          kind: 'oauth',
          channel: 'mcp',
          scopes: grant.scopes,
          readOnly: grant.readOnly,
          allMaps: caps.allMaps,
          maps: caps.maps,
        },
      },
    };
  }

  // ---- approvals in the account page ---------------------------------------------------------

  async listGrants(actor: Actor | null): Promise<OAuthGrantDto[]> {
    const account = this.sessionAccount(actor);
    const grants = (await this.deps.store.listGrants(account.id)).filter((g) => g.revokedAt === null);
    const mapIds = [...new Set(grants.flatMap((g) => g.scopes.flatMap((s) => parseScope(s)?.mapId ?? [])))];
    const names = new Map((mapIds.length ? await this.deps.maps.describe(mapIds) : []).map((m) => [m.id, m]));
    return grants.map((g) => ({
      id: g.id,
      clientName: g.clientName,
      clientUri: g.clientUri,
      scopes: g.scopes,
      readOnly: g.readOnly,
      maps: [...new Set(g.scopes.flatMap((s) => parseScope(s)?.mapId ?? []))].flatMap(
        (id) => names.get(id) ?? [],
      ),
      createdAt: g.createdAt,
      lastUsedAt: g.lastUsedAt,
      lastUsedIp: g.lastUsedIp,
    }));
  }

  async revokeGrant(actor: Actor | null, grantId: string): Promise<void> {
    const account = this.sessionAccount(actor);
    const grant = await this.deps.store.findGrant(grantId);
    if (!grant || grant.accountId !== account.id) throw new NotFoundError('Approval');
    if (grant.revokedAt !== null) return;
    await this.deps.uow.transaction(async () => {
      await this.deps.store.updateGrant({ ...grant, revokedAt: this.deps.clock.now() });
      await this.audit(account, 'oauth.grant_revoked', this.auditView(grant), this.auditView(grant));
    });
  }

  async prune(): Promise<number> {
    return this.deps.store.prune(this.deps.clock.now());
  }

  private async revokeGrantById(grantId: string): Promise<void> {
    const grant = await this.deps.store.findGrant(grantId);
    if (!grant || grant.revokedAt !== null) return;
    await this.deps.uow.transaction(async () => {
      await this.deps.store.updateGrant({ ...grant, revokedAt: this.deps.clock.now() });
      await this.audit(
        { kind: 'system', id: 'oauth' },
        'oauth.grant_revoked',
        this.auditView(grant),
        this.auditView(grant),
      );
    });
  }

  private sessionAccount(actor: Actor | null): AccountActor {
    const account = requireAccount(actor);
    if (account.grant) throw new ForbiddenError('Approvals are managed from the web app');
    return account;
  }

  private auditView(grant: OAuthGrant) {
    return {
      id: grant.id,
      accountId: grant.accountId,
      clientId: grant.clientId,
      clientName: grant.clientName,
      scopes: grant.scopes,
      readOnly: grant.readOnly,
    };
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
}
