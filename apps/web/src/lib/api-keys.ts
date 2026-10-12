'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type ApiKeyDto,
  type CreateApiKeyRequest,
  type CreatedApiKeyDto,
  type CreateServiceKeyRequest,
} from '@darkbeacon/shared';
import { api } from './api';

/** The account's own personal access tokens. */
export const apiKeysKey = ['api-keys'] as const;
/** Every key of the instance (instance admins). */
export const adminApiKeysKey = ['admin-api-keys'] as const;

/** Whose keys a list manages: the account's own, or any key as an instance admin. */
export type KeyScope = 'own' | 'admin';

function useRefreshKeys() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: apiKeysKey }),
      queryClient.invalidateQueries({ queryKey: adminApiKeysKey }),
    ]);
}

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeysKey,
    queryFn: () => api<ApiKeyDto[]>(routes.apiKeys.list.path),
  });
}

/** Instance admins: personal and service keys of everyone. */
export function useAdminApiKeys() {
  return useQuery({
    queryKey: adminApiKeysKey,
    queryFn: () => api<ApiKeyDto[]>(routes.apiKeys.adminList.path),
  });
}

/** Makes a personal access token; the answer carries the token, shown once. */
export function useCreateApiKey() {
  const refresh = useRefreshKeys();
  return useMutation({
    mutationFn: (body: CreateApiKeyRequest) =>
      api<CreatedApiKeyDto>(routes.apiKeys.create.path, { method: 'POST', json: body }),
    onSuccess: () => void refresh(),
  });
}

/** Makes a service key (instance admins); the answer carries the token, shown once. */
export function useCreateServiceKey() {
  const refresh = useRefreshKeys();
  return useMutation({
    mutationFn: (body: CreateServiceKeyRequest) =>
      api<CreatedApiKeyDto>(routes.apiKeys.createService.path, { method: 'POST', json: body }),
    onSuccess: () => void refresh(),
  });
}

/** A new secret for a key; the old one stops working at once. */
export function useRotateApiKey() {
  const refresh = useRefreshKeys();
  return useMutation({
    mutationFn: (key: Pick<ApiKeyDto, 'id' | 'kind'>) =>
      api<CreatedApiKeyDto>(
        buildPath(key.kind === 'svc' ? routes.apiKeys.rotateService.path : routes.apiKeys.rotate.path, {
          keyId: key.id,
        }),
        { method: 'POST' },
      ),
    onSuccess: () => void refresh(),
  });
}

/** Revokes a key: the account's own, or any key as an instance admin. */
export function useRevokeApiKey(scope: KeyScope) {
  const refresh = useRefreshKeys();
  return useMutation({
    mutationFn: (key: Pick<ApiKeyDto, 'id'>) =>
      api<void>(
        buildPath(scope === 'admin' ? routes.apiKeys.adminRevoke.path : routes.apiKeys.revoke.path, {
          keyId: key.id,
        }),
        { method: 'DELETE' },
      ),
    onSuccess: () => void refresh(),
  });
}
