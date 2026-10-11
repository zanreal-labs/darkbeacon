import { ExternalAuthError } from '@wormwright/identity';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Token response of an OAuth2 token endpoint (RFC 6749 section 5.1). */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * POSTs a form to a token endpoint with HTTP Basic client authentication. A 400/401 answer
 * means the provider rejected the grant; anything else unexpected is a plain error.
 */
export async function requestToken(
  fetchFn: FetchLike,
  provider: 'discord' | 'eve',
  url: string,
  client: OAuthClient,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 400 || response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };
    throw new ExternalAuthError(provider, body.error_description ?? body.error ?? 'The grant was rejected');
  }
  if (!response.ok) throw new Error(`${provider} token endpoint answered ${response.status}`);
  const body = (await response.json()) as Partial<TokenResponse>;
  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== 'number') {
    throw new Error(`${provider} token endpoint returned an incomplete token`);
  }
  return body as TokenResponse;
}
