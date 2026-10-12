'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type OAuthAuthorizeDecision,
  type OAuthGrantDto,
  type OAuthRedirectDto,
} from '@darkbeacon/shared';
import { api } from './api';

/** Apps (MCP clients) the account let act for it. */
export const oauthGrantsKey = ['oauth-grants'] as const;

export function useOAuthGrants() {
  return useQuery({
    queryKey: oauthGrantsKey,
    queryFn: () => api<OAuthGrantDto[]>(routes.oauth.grants.path),
  });
}

/** Ends an approval; every token it gave stops working. */
export function useRevokeOAuthGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grant: Pick<OAuthGrantDto, 'id'>) =>
      api<void>(buildPath(routes.oauth.revokeGrant.path, { grantId: grant.id }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: oauthGrantsKey }),
  });
}

/** Posts the person's answer on the consent page; the answer says where the browser goes next. */
export function decideAuthorization(decision: OAuthAuthorizeDecision): Promise<OAuthRedirectDto> {
  return api<OAuthRedirectDto>(routes.oauth.decide.path, { method: 'POST', json: decision });
}
