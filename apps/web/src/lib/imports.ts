'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  WANDERER_EXPORT_CONTENT_TYPE,
  type ImportJobDto,
  type ImportJobSnapshot,
  type ImportPlanDto,
  type ImportPlanRequest,
  type ImportSyncDto,
  type StartImportRequest,
  type WandererApiSourceRequest,
  type WandererDbConnectRequest,
  type WandererDbMapsDto,
  type WandererDbSourceRequest,
  type WandererTestResultDto,
} from '@darkbeacon/shared';
import { api, ApiError } from './api';
import { useStream } from './RealtimeProvider';
import type { StreamMessage } from './realtime';

const r = routes.imports;

export const importJobKey = (jobId: string) => ['import', jobId] as const;
export const importSyncKey = (mapId: string) => ['import-sync', mapId] as const;

const RUNNING = new Set(['queued', 'running']);

/**
 * One import, kept current by its `import:<id>` stream (progress as the server publishes it) and,
 * while it runs, by polling as a fallback when the socket is away.
 */
export function useImportJob(jobId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: importJobKey(jobId ?? ''),
    queryFn: () => api<ImportJobDto>(buildPath(r.get.path, { jobId: jobId! })),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data && RUNNING.has(q.state.data.status) ? 3000 : false),
  });
  const onMessage = useCallback(
    (message: StreamMessage) => {
      if (!jobId) return;
      const job =
        message.op === 'snapshot'
          ? (message.data as ImportJobSnapshot).job
          : message.op === 'event' && message.event.type === 'import.progress'
            ? (message.event.data as ImportJobDto)
            : undefined;
      if (job) queryClient.setQueryData(importJobKey(jobId), job);
    },
    [jobId, queryClient],
  );
  useStream(jobId && query.data && RUNNING.has(query.data.status) ? `import:${jobId}` : null, onMessage);
  return query;
}

export function useTestWanderer() {
  return useMutation({
    mutationFn: (source: WandererApiSourceRequest) =>
      api<WandererTestResultDto>(r.test.path, { method: 'POST', json: source }),
  });
}

export function useReadWanderer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: WandererApiSourceRequest) =>
      api<ImportJobDto>(r.previewApi.path, { method: 'POST', json: source }),
    onSuccess: (job) => queryClient.setQueryData(importJobKey(job.id), job),
  });
}

/** The maps a Wanderer database holds (instance admins). */
export function useWandererDbMaps() {
  return useMutation({
    mutationFn: (request: WandererDbConnectRequest) =>
      api<WandererDbMapsDto>(r.dbMaps.path, { method: 'POST', json: request }),
  });
}

/** Reads one map from a Wanderer database into a preview (instance admins). */
export function useReadWandererDb() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: WandererDbSourceRequest) =>
      api<ImportJobDto>(r.previewDb.path, { method: 'POST', json: source }),
    onSuccess: (job) => queryClient.setQueryData(importJobKey(job.id), job),
  });
}

/** Sends an export file as the request body (streamed by the browser, checked by the server). */
export function useUploadExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<ImportJobDto>(`${r.previewFile.path}?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': WANDERER_EXPORT_CONTENT_TYPE },
        body: file,
      }),
    onSuccess: (job) => queryClient.setQueryData(importJobKey(job.id), job),
  });
}

/** What importing into a new map, or merging into `mapId`, would do (re-read when they change). */
export function useImportPlan(jobId: string | null, request: ImportPlanRequest | null) {
  return useQuery({
    queryKey: ['import-plan', jobId, request?.mode, request?.mapId ?? null],
    queryFn: () =>
      api<ImportPlanDto>(buildPath(r.plan.path, { jobId: jobId! }), { method: 'POST', json: request }),
    enabled: jobId !== null && request !== null && (request.mode === 'new' || !!request.mapId),
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
}

export function useStartImport(jobId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StartImportRequest) =>
      api<ImportJobDto>(buildPath(r.start.path, { jobId: jobId! }), { method: 'POST', json: request }),
    onSuccess: (job) => queryClient.setQueryData(importJobKey(job.id), job),
  });
}

export function useCancelImport(jobId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<ImportJobDto>(buildPath(r.cancel.path, { jobId: jobId! }), { method: 'POST' }),
    onSuccess: (job) => queryClient.setQueryData(importJobKey(job.id), job),
  });
}

export function importReportUrl(jobId: string): string {
  return buildPath(r.report.path, { jobId });
}

/** The map's sync from Wanderer (null when none runs). */
export function useImportSync(mapId: string | undefined) {
  return useQuery({
    queryKey: importSyncKey(mapId ?? ''),
    queryFn: async () => (await api<ImportSyncDto | null>(buildPath(r.sync.path, { mapId: mapId! }))) ?? null,
    enabled: !!mapId,
  });
}

export function useStopSync(mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(buildPath(r.stopSync.path, { mapId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.setQueryData(importSyncKey(mapId), null),
  });
}
