'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Network, Trash2, X } from 'lucide-react';
import {
  buildPath,
  DEFAULT_SHARE_SCOPES,
  routes,
  SENSITIVE_SHARE_SCOPES,
  shareScope,
  type MapDto,
  type MapShareDto,
  type MapSharesDto,
  type MapSummaryDto,
  type OfferShareRequest,
  type ShareLevel,
  type ShareScope,
  type UpdateShareRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { mapsKey } from '../lib/session-keys';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  SkeletonRows,
  Stack,
  Switch,
  useToast,
} from '../ui';
import styles from './settings.module.css';
import own from './sharing.module.css';

/** What each scope lets the other map see, in one line. */
export const SCOPE_TEXT: Record<ShareScope, { label: string; hint: string }> = {
  topology: {
    label: 'Systems and connections',
    hint: 'Always shared: which systems are in the chain and how they link.',
  },
  connectionStatus: { label: 'Connection status', hint: 'Mass, time left, ship size, bubbles and danger.' },
  signatures: { label: 'Signatures', hint: 'What has been scanned in each system.' },
  intel: { label: 'System intel', hint: 'Status, custom names and notes of systems.' },
  characters: {
    label: 'Characters',
    hint: 'Where your tracked pilots are, their ships and whether they are online.',
  },
  labels: {
    label: 'Labels',
    hint: 'Labels like WH1 (matched by name), custom labels and temporary names of systems. Tags stay on your map.',
  },
};

const LEVELS: { value: ShareLevel; label: string }[] = [
  { value: 'read', label: 'Read only' },
  { value: 'read-write', label: 'Read and write' },
];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Checkboxes for scopes; topology is always on, sensitive ones are marked. */
function ScopeChecklist({
  value,
  allowed,
  onChange,
  disabled,
}: {
  value: readonly ShareScope[];
  /** Scopes that may be picked (what the source offers); all when omitted. */
  allowed?: readonly ShareScope[];
  onChange(scopes: ShareScope[]): void;
  disabled?: boolean;
}) {
  const set = new Set(value);
  return (
    <div className={own.scopes}>
      {shareScope.options.map((scope) => {
        const sensitive = SENSITIVE_SHARE_SCOPES.includes(scope);
        const unavailable = allowed !== undefined && !allowed.includes(scope);
        return (
          <Checkbox
            key={scope}
            checked={scope === 'topology' || set.has(scope)}
            disabled={disabled || scope === 'topology' || unavailable}
            onCheckedChange={(checked) =>
              onChange(
                shareScope.options.filter((s) => (s === scope ? checked : s === 'topology' || set.has(s))),
              )
            }
            label={
              <span className={own.scopeLabel}>
                {SCOPE_TEXT[scope].label}
                {sensitive && (
                  <Badge tone="warning" variant="outline">
                    Sensitive
                  </Badge>
                )}
              </span>
            }
            description={unavailable ? 'Not offered by the shared map.' : SCOPE_TEXT[scope].hint}
          />
        );
      })}
    </div>
  );
}

const scopeSummary = (scopes: readonly ShareScope[]) =>
  scopes
    .filter((s) => s !== 'topology')
    .map((s) => SCOPE_TEXT[s].label.toLowerCase())
    .join(', ') || 'systems and connections only';

/**
 * Map settings, Sharing: what this map shares with other maps (offers, level, scopes) and what other
 * maps share with it (accept, narrow, hide for now, revoke). Map admins only.
 */
export function MapSharing({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['map-shares', map.id];
  const shares = useQuery({
    queryKey: key,
    queryFn: () => api<MapSharesDto>(buildPath(routes.sharing.list.path, { mapId: map.id })),
  });
  const [revoking, setRevoking] = useState<MapShareDto | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: errorText(error, 'Try again.'), tone: 'danger' });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateShareRequest }) =>
      api<MapShareDto>(buildPath(routes.sharing.update.path, { mapId: map.id, shareId: id }), {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: refresh,
    onError: failed('Could not change the share'),
  });
  const accept = useMutation({
    mutationFn: (share: MapShareDto) =>
      api<MapShareDto>(buildPath(routes.sharing.accept.path, { mapId: map.id, shareId: share.id }), {
        method: 'POST',
        json: {},
      }),
    onSuccess: (share) => {
      void refresh();
      toast({ title: `${share.sourceName} is merged into this map now`, tone: 'success' });
    },
    onError: failed('Could not accept the share'),
  });
  const revoke = async (share: MapShareDto) => {
    try {
      await api<void>(buildPath(routes.sharing.revoke.path, { mapId: map.id, shareId: share.id }), {
        method: 'DELETE',
      });
      await refresh();
    } catch (error) {
      failed('Could not end the share')(error);
    }
  };

  const incoming = shares.data?.incoming ?? [];
  const outgoing = shares.data?.outgoing ?? [];

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Shared with this map"
          description={
            map.kind === 'composite'
              ? 'This map shows only what other maps share with it, merged into one chain.'
              : 'Maps shared with this one show here merged with its own systems.'
          }
        />
        <CardBody flush>
          {shares.isPending ? (
            <SkeletonRows count={2} />
          ) : shares.isError ? (
            <ErrorState compact error={shares.error} onRetry={() => void shares.refetch()} />
          ) : incoming.length === 0 ? (
            <EmptyState
              compact
              icon={<Network />}
              title="Nothing shared with this map yet"
              description="An admin of another map offers it from that map’s Sharing settings; the offer shows here to accept."
            />
          ) : (
            <ul className={styles.list}>
              {incoming.map((share) => (
                <li key={share.id} className={styles.item}>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {share.sourceName}
                      {share.sourceInstanceName && (
                        <span className={styles.version}>{share.sourceInstanceName}</span>
                      )}
                      <Badge tone={share.level === 'read-write' ? 'accent' : 'neutral'}>
                        {share.level === 'read-write' ? 'Read and write' : 'Read only'}
                      </Badge>
                      {share.status === 'offered' && <Badge tone="warning">Offered</Badge>}
                      {share.status === 'active' && share.offeredLevel && (
                        <Badge tone="warning">Offers read and write</Badge>
                      )}
                      {map.kind === 'composite' && share.defaultWrite && (
                        <Badge tone="neutral">New systems go here</Badge>
                      )}
                    </div>
                    <div className={styles.rowMeta}>Shares {scopeSummary(share.scopes)}</div>
                    {share.status === 'active' && (
                      <details className={own.details}>
                        <summary>What this map receives</summary>
                        <ScopeChecklist
                          value={share.scopes}
                          allowed={share.offeredScopes}
                          disabled={update.isPending}
                          onChange={(scopes) => update.mutate({ id: share.id, body: { scopes } })}
                        />
                      </details>
                    )}
                  </div>
                  <div className={styles.rowActions}>
                    {share.status === 'offered' ? (
                      <>
                        <Button size="sm" variant="ghost" icon={<X />} onClick={() => setRevoking(share)}>
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Check />}
                          loading={accept.isPending && accept.variables?.id === share.id}
                          onClick={() => accept.mutate(share)}
                        >
                          Accept
                        </Button>
                      </>
                    ) : (
                      <>
                        {share.offeredLevel && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<Check />}
                            loading={accept.isPending && accept.variables?.id === share.id}
                            onClick={() => accept.mutate(share)}
                          >
                            Allow writes
                          </Button>
                        )}
                        {map.kind === 'composite' && share.level === 'read-write' && !share.defaultWrite && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => update.mutate({ id: share.id, body: { defaultWrite: true } })}
                          >
                            Send new systems here
                          </Button>
                        )}
                        <Switch
                          checked={!share.hidden}
                          label="Show"
                          onCheckedChange={(shown) =>
                            update.mutate({ id: share.id, body: { hidden: !shown } })
                          }
                        />
                        <IconButton
                          size="sm"
                          label={`Stop merging ${share.sourceName}`}
                          icon={<Trash2 />}
                          onClick={() => setRevoking(share)}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {map.kind === 'composite' ? null : (
        <>
          <Card>
            <CardHeader
              title="This map shared with others"
              description="Other maps see what you share, merged into theirs, and nothing of this map’s access list."
            />
            <CardBody flush>
              {shares.isPending ? (
                <SkeletonRows count={1} />
              ) : outgoing.length === 0 ? (
                <EmptyState compact icon={<Network />} title="Not shared with any map" />
              ) : (
                <ul className={styles.list}>
                  {outgoing.map((share) => (
                    <li key={share.id} className={styles.item}>
                      <div className={styles.rowBody}>
                        <div className={styles.rowTitle}>
                          {share.targetName}
                          {share.status === 'offered' && <Badge tone="warning">Waiting for its admin</Badge>}
                          {share.offeredLevel && <Badge tone="warning">Writes wait for its admin</Badge>}
                        </div>
                        <div className={styles.rowMeta}>Receives {scopeSummary(share.scopes)}</div>
                        <details className={own.details}>
                          <summary>What you share</summary>
                          <ScopeChecklist
                            value={share.offeredScopes}
                            disabled={update.isPending}
                            onChange={(scopes) => update.mutate({ id: share.id, body: { scopes } })}
                          />
                        </details>
                      </div>
                      <div className={styles.rowActions}>
                        <Select
                          size="sm"
                          aria-label={`Level for ${share.targetName}`}
                          value={share.offeredLevel ?? share.level}
                          options={LEVELS}
                          onValueChange={(level) =>
                            update.mutate({ id: share.id, body: { level: level as ShareLevel } })
                          }
                        />
                        <IconButton
                          size="sm"
                          label={`Stop sharing with ${share.targetName}`}
                          icon={<Trash2 />}
                          onClick={() => setRevoking(share)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <OfferShare map={map} onOffered={() => void refresh()} />
        </>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={
          revoking?.status === 'offered' && revoking.target.mapId === map.id
            ? `Decline ${revoking.sourceName}?`
            : revoking?.target.mapId === map.id
              ? `Stop merging ${revoking.sourceName}?`
              : `Stop sharing with ${revoking?.targetName ?? ''}?`
        }
        description={
          revoking?.target.mapId === map.id
            ? 'Its systems leave this map at once. Its admins can offer it again.'
            : 'That map stops showing this one at once. You can offer it again.'
        }
        confirmLabel={revoking?.status === 'offered' && revoking.target.mapId === map.id ? 'Decline' : 'Stop'}
        tone="danger"
        onConfirm={() => revoking && revoke(revoking)}
      />
    </Stack>
  );
}

/** Offers this map to another map: picked from the maps the admin can see, or by its address. */
function OfferShare({ map, onOffered }: { map: MapDto; onOffered(): void }) {
  const toast = useToast();
  const maps = useQuery({
    queryKey: mapsKey,
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
  });
  const others = (maps.data ?? []).filter((m) => m.id !== map.id);
  const [target, setTarget] = useState<string>('');
  const [address, setAddress] = useState('');
  const [level, setLevel] = useState<ShareLevel>('read');
  const [scopes, setScopes] = useState<ShareScope[]>([...DEFAULT_SHARE_SCOPES]);
  const offer = useMutation({
    mutationFn: (body: OfferShareRequest) =>
      api<MapShareDto>(buildPath(routes.sharing.offer.path, { mapId: map.id }), {
        method: 'POST',
        json: body,
      }),
    onSuccess: (share) => {
      setTarget('');
      setAddress('');
      onOffered();
      toast({
        title:
          share.status === 'active'
            ? `${share.targetName} merges this map now`
            : `Offered to ${share.targetName}; its admins accept it in their Sharing settings`,
        tone: 'success',
      });
    },
  });
  const OTHER = '__address';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const where = target === OTHER ? { targetSlug: address.trim() } : target ? { targetMapId: target } : null;
    if (where) offer.mutate({ ...where, level, scopes });
  };
  return (
    <Card>
      <form onSubmit={submit} aria-label="Share this map">
        <CardHeader
          title="Share this map"
          description="The other map’s admins accept it before anything is shown there; you can stop at any time."
        />
        <CardBody>
          <Stack>
            <div className={own.offerGrid}>
              <Field label="With map">
                <Select
                  value={target || undefined}
                  placeholder="Pick a map"
                  options={[
                    ...others.map((m) => ({
                      value: m.id,
                      label: m.kind === 'composite' ? `${m.name} (composite)` : m.name,
                    })),
                    { value: OTHER, label: 'Another map, by its address…' },
                  ]}
                  onValueChange={setTarget}
                />
              </Field>
              {target === OTHER && (
                <Field label="Address" hint="The part after /m/ in the map’s link.">
                  <Input
                    mono
                    required
                    placeholder="alliance-chain"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Field>
              )}
              <Field
                label="They may"
                hint={
                  level === 'read-write'
                    ? 'Their editors change what you share; it is written to this map.'
                    : 'They see it; changes stay with this map.'
                }
              >
                <Select value={level} options={LEVELS} onValueChange={(v) => setLevel(v as ShareLevel)} />
              </Field>
            </div>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>What they see</legend>
              <ScopeChecklist value={scopes} onChange={setScopes} />
            </fieldset>
          </Stack>
        </CardBody>
        <CardFooter>
          {offer.error && (
            <span className={styles.footerNote} role="alert">
              {errorText(offer.error, 'Could not share the map.')}
            </span>
          )}
          <Button
            type="submit"
            variant="primary"
            loading={offer.isPending}
            disabled={!target || (target === OTHER && !address.trim())}
          >
            Share
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
