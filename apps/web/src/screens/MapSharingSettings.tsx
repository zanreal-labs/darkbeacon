'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Globe, KeyRound, Lock, RefreshCw } from 'lucide-react';
import {
  buildPath,
  routes,
  SENSITIVE_SHARE_SCOPES,
  Slug,
  type MapDto,
  type MapSharingDto,
  type McpMode,
  type ShareScope,
  type UpdateMapSharingRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { useInstance } from '../lib/maps';
import { listWords } from '../lib/scope-builder';
import { SHARE_SCOPE_ORDER, SHARE_SCOPE_TEXT } from '../lib/share-scopes';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChoiceGroup,
  ConfirmDialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  Skeleton,
  Stack,
  Switch,
  useToast,
} from '../ui';
import { CopyValue, useOrigin } from './ApiKeyParts';
import settings from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export const mapSharingKey = (mapId: string) => ['map-sharing', mapId] as const;

/**
 * Map settings, Sharing (map admins): the public link (`/p/<token>`), what it shows, and whether
 * AI agents may reach the map.
 */
export function MapSharingSettings({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = mapSharingKey(map.id);
  const instance = useInstance();
  const sharing = useQuery({
    queryKey: key,
    queryFn: () => api<MapSharingDto>(buildPath(routes.sharing.get.path, { mapId: map.id })),
  });
  const update = useMutation({
    mutationFn: (body: UpdateMapSharingRequest) =>
      api<MapSharingDto>(buildPath(routes.sharing.update.path, { mapId: map.id }), {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const failed = (error: unknown) =>
    toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' });
  const change = (body: UpdateMapSharingRequest, success?: string) =>
    update.mutate(body, {
      onSuccess: () => success && toast({ title: success, tone: 'success' }),
      onError: failed,
    });

  if (sharing.isPending)
    return (
      <Stack aria-busy="true">
        <Skeleton width="100%" height={160} radius={10} />
        <Skeleton width="100%" height={260} radius={10} />
      </Stack>
    );
  if (sharing.isError)
    return (
      <ErrorState
        title="Sharing could not be loaded"
        error={sharing.error}
        onRetry={() => void sharing.refetch()}
      />
    );
  const share = sharing.data;
  // Older servers do not say; then the server's answer (403) is the warning.
  const publicMapsOff = instance.data?.publicMaps === false;
  const agentsOff = instance.data?.mcpMode === 'off';
  return (
    <Stack>
      {publicMapsOff && (
        <Callout tone="warning" title="Public maps are switched off on this instance">
          An instance admin can switch them on in Admin, API access. Links stay off until then.
        </Callout>
      )}
      <PublicLink
        map={map}
        share={share}
        busy={update.isPending || (publicMapsOff && !share.enabled)}
        onChange={change}
      />
      <WhatItShows share={share} busy={update.isPending} onChange={change} />
      <AgentAccess share={share} busy={update.isPending} onChange={change} agentsOff={agentsOff} />
    </Stack>
  );
}

type Change = (body: UpdateMapSharingRequest, success?: string) => void;

/** `url` may be absolute (it is, from the server) or a path. */
const absolute = (url: string, origin: string) => (/^https?:\/\//.test(url) ? url : `${origin}${url}`);

function PublicLink({
  map,
  share,
  busy,
  onChange,
}: {
  map: MapDto;
  share: MapSharingDto;
  busy: boolean;
  onChange: Change;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const origin = useOrigin();
  const [slug, setSlug] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const value = slug ?? share.slug ?? '';
  const dirty = slug !== null && slug.trim() !== (share.slug ?? '');
  const parsed = value.trim() === '' ? null : Slug.safeParse(value.trim());
  const slugError = parsed && !parsed.success ? 'Use lowercase letters, digits and dashes (2 to 48).' : null;
  const saveSlug = useMutation({
    mutationFn: (next: string | null) =>
      api<MapSharingDto>(buildPath(routes.sharing.update.path, { mapId: map.id }), {
        method: 'PATCH',
        json: { slug: next },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(mapSharingKey(map.id), data);
      setSlug(null);
      toast({ title: 'Readable name saved', tone: 'success' });
    },
  });
  const regenerate = useMutation({
    mutationFn: () =>
      api<MapSharingDto>(buildPath(routes.sharing.regenerate.path, { mapId: map.id }), { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(mapSharingKey(map.id), data);
      toast({ title: 'New link made', description: 'The old link no longer works.', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not make a new link',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || slugError) return;
    saveSlug.mutate(value.trim() === '' ? null : value.trim());
  };
  const link = share.url ? absolute(share.url, origin) : null;
  const readable = share.enabled && share.slug && origin ? `${origin}/p/${share.slug}` : null;
  const open = (href: string, label: string) => (
    <IconButton asChild size="sm" label={label} icon={<ArrowUpRight />}>
      <a href={href} target="_blank" rel="noreferrer" />
    </IconButton>
  );

  return (
    <Card>
      <form onSubmit={submit} aria-label="Public link">
        <CardHeader
          title="Public link"
          description="Anyone with the link sees this map read-only and live, without signing in."
          actions={
            <Switch
              checked={share.enabled}
              disabled={busy}
              onCheckedChange={(enabled) =>
                onChange({ enabled }, enabled ? 'The map is public' : 'The public link is off')
              }
              label={<span className="sr-only">Share this map with a public link</span>}
            />
          }
        />
        {share.enabled && (
          <CardBody>
            <div className={settings.formStack}>
              {link && (
                <CopyValue
                  label="Link"
                  value={link}
                  copyLabel="Copy link"
                  copied="Link copied"
                  extra={open(link, 'Open the public view')}
                />
              )}
              {readable && (
                <CopyValue
                  label="Readable link"
                  value={readable}
                  copyLabel="Copy readable link"
                  copied="Link copied"
                  extra={open(readable, 'Open the readable link')}
                />
              )}
              <Field
                label="Readable name"
                optional
                hint="Gives the map a second, easier link. Anyone can guess it, so only use it for maps meant for everyone."
                error={
                  slugError ?? (saveSlug.error ? errorText(saveSlug.error, 'Could not save.') : undefined)
                }
              >
                <Input
                  mono
                  icon={<span className="muted mono">/p/</span>}
                  value={value}
                  maxLength={48}
                  placeholder={map.slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    saveSlug.reset();
                  }}
                />
              </Field>
              <Switch
                checked={share.noindex}
                disabled={busy}
                onCheckedChange={(noindex) => onChange({ noindex })}
                label="Ask search engines not to index it"
                description="On by default. Search engines that respect it leave the page out of their results."
              />
            </div>
          </CardBody>
        )}
        {share.enabled && (
          <CardFooter>
            <Button icon={<RefreshCw />} onClick={() => setRenewing(true)}>
              New link…
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setSlug(null)}>
                Discard
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={saveSlug.isPending}
              disabled={!dirty || !!slugError}
            >
              Save
            </Button>
          </CardFooter>
        )}
      </form>
      <ConfirmDialog
        open={renewing}
        onOpenChange={setRenewing}
        title="Make a new link?"
        description="The current link stops working at once, for everyone who has it and for pages open on it. Share the new one again."
        confirmLabel="Make a new link"
        tone="danger"
        onConfirm={() => regenerate.mutateAsync().catch(() => {})}
      />
    </Card>
  );
}

function WhatItShows({ share, busy, onChange }: { share: MapSharingDto; busy: boolean; onChange: Change }) {
  const on = new Set<ShareScope>([...share.scopes, 'topology']);
  const toggle = (scope: ShareScope, enabled: boolean) => {
    const next = new Set(on);
    if (enabled) next.add(scope);
    else next.delete(scope);
    onChange({ scopes: SHARE_SCOPE_ORDER.filter((s) => next.has(s)) });
  };
  const sensitive = SENSITIVE_SHARE_SCOPES.filter((s) => on.has(s));
  const label = (scope: ShareScope): ReactNode =>
    SENSITIVE_SHARE_SCOPES.includes(scope) ? (
      <>
        {SHARE_SCOPE_TEXT[scope].label}{' '}
        <Badge tone="warning" variant="outline">
          Sensitive
        </Badge>
      </>
    ) : (
      SHARE_SCOPE_TEXT[scope].label
    );
  return (
    <Card>
      <CardHeader
        title="What the link shows"
        description="Visitors see only what is switched on here. Changes reach open pages at once."
      />
      <CardBody>
        <div className={settings.formStack}>
          {sensitive.length > 0 && (
            <Callout tone="warning" title="The link shows sensitive information">
              Anyone who gets the link sees{' '}
              {listWords(sensitive.map((s) => (s === 'intel' ? 'your intel' : 'where your pilots are')))}.
              Share it only with people you trust.
            </Callout>
          )}
          {SHARE_SCOPE_ORDER.map((scope) => (
            <Switch
              key={scope}
              checked={on.has(scope)}
              disabled={scope === 'topology' || busy}
              onCheckedChange={(enabled) => toggle(scope, enabled)}
              label={label(scope)}
              description={SHARE_SCOPE_TEXT[scope].description}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function AgentAccess({
  share,
  busy,
  onChange,
  agentsOff,
}: {
  share: MapSharingDto;
  busy: boolean;
  onChange: Change;
  agentsOff: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="AI agents"
        description="Whether agents on the MCP endpoint may reach this map. The instance's own setting comes first."
      />
      <CardBody>
        <div className={settings.formStack}>
          {agentsOff && (
            <Callout tone="neutral" title="AI agents are off on this instance">
              This choice applies once an instance admin switches the MCP endpoint on in Admin, API access.
            </Callout>
          )}
          <ChoiceGroup
            aria-label="AI agent access to this map"
            value={share.mcpMode}
            disabled={busy}
            onValueChange={(mcpMode) => onChange({ mcpMode: mcpMode as McpMode }, 'AI agent access saved')}
            options={[
              { value: 'off', label: 'Off', icon: <Lock />, description: 'Agents cannot reach this map.' },
              {
                value: 'authenticated',
                label: 'API keys only',
                icon: <KeyRound />,
                description: 'Agents with a key that names this map, doing what its owner could.',
              },
              {
                value: 'public',
                label: 'Public too',
                icon: <Globe />,
                disabled: !share.enabled && share.mcpMode !== 'public',
                description: share.enabled
                  ? 'Without a key, agents may also read what the public link shows.'
                  : 'Switch the public link on first.',
              },
            ]}
          />
        </div>
      </CardBody>
    </Card>
  );
}
