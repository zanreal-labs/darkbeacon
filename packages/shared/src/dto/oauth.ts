import { z } from 'zod';
import { Id, Timestamp } from './common.js';

/**
 * OAuth 2.1 for the MCP endpoint (see docs/mcp.md). The authorization endpoint is the web app's
 * page `/oauth/authorize`, which reads the request with `GET /api/oauth/authorize` and posts the
 * person's decision to `POST /api/oauth/authorize`.
 */
export const OAuthAuthorizeQuery = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, 'expected an S256 code challenge'),
  code_challenge_method: z.string(),
  scope: z.string().max(4096).optional(),
  state: z.string().max(1024).optional(),
  resource: z.string().max(2048).optional(),
});
export type OAuthAuthorizeQuery = z.infer<typeof OAuthAuthorizeQuery>;

/** What the consent page shows: the client, where it sends the person back, what it asks for. */
export const OAuthAuthorizeRequestDto = z.object({
  client: z.object({
    id: z.string(),
    name: z.string(),
    /** `metadata`: identified by a Client ID Metadata Document (its URL); `registered`: dynamic registration. */
    kind: z.enum(['metadata', 'registered']),
    uri: z.string().nullable(),
  }),
  /** Host of the redirect URI, so people see where they are sent. */
  redirectHost: z.string(),
  /** Scopes the client asks for (defaults to read access when it asks for none). */
  scopes: z.array(z.string()),
  resource: z.string(),
});
export type OAuthAuthorizeRequestDto = z.infer<typeof OAuthAuthorizeRequestDto>;

export const OAuthAuthorizeDecision = OAuthAuthorizeQuery.extend({
  approve: z.boolean(),
  /** Narrow the map scopes to these maps (by id, picked by name); null: every map they reach. */
  maps: z.array(Id).max(100).nullable().default(null),
  readOnly: z.boolean().default(false),
});
export type OAuthAuthorizeDecision = z.infer<typeof OAuthAuthorizeDecision>;

/** Where the browser goes next: the client's redirect URI with a code (or an error). */
export const OAuthRedirectDto = z.object({ redirectTo: z.string() });
export type OAuthRedirectDto = z.infer<typeof OAuthRedirectDto>;

/** An approval: a client a person let act for them on /mcp. */
export const OAuthGrantDto = z.object({
  id: Id,
  clientName: z.string(),
  clientUri: z.string().nullable(),
  scopes: z.array(z.string()),
  readOnly: z.boolean(),
  /** Names of the maps the scopes name. */
  maps: z.array(z.object({ id: Id, name: z.string(), slug: z.string() })),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
  lastUsedIp: z.string().nullable(),
});
export type OAuthGrantDto = z.infer<typeof OAuthGrantDto>;

/** RFC 7591 dynamic registration (public clients only). */
export const OAuthRegisterRequest = z
  .object({
    redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
    client_name: z.string().max(100).optional(),
    client_uri: z.string().max(2048).optional(),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    scope: z.string().max(4096).optional(),
  })
  .passthrough();
export type OAuthRegisterRequest = z.infer<typeof OAuthRegisterRequest>;

export const OAuthRegisteredClientDto = z.object({
  client_id: z.string(),
  client_id_issued_at: z.number().int(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  token_endpoint_auth_method: z.literal('none'),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
});
export type OAuthRegisteredClientDto = z.infer<typeof OAuthRegisteredClientDto>;

/** The token endpoint's form body (`application/x-www-form-urlencoded`). */
export const OAuthTokenRequest = z.object({
  grant_type: z.string(),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  client_id: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  resource: z.string().optional(),
  scope: z.string().optional(),
});
export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequest>;

export const OAuthTokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  scope: z.string(),
});
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponse>;
