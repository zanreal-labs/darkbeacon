'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Map as MapIcon, MoreHorizontal, RotateCcw, Search, Trash2, UserRound } from 'lucide-react';
import { buildPath, routes, type AdminMapDto, type MapDto } from '@darkbeacon/shared';
import { AccountPicker, type AccountOption } from '../components/pickers';
import { api, ApiError } from '../lib/api';
import { mapsKey } from '../lib/session-keys';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SkeletonRows,
  Switch,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export const adminMapsKey = ['admin-maps'] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every map of the instance with its owner, for instance admins. Never what is on a map. */
export function AdminMapsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [handover, setHandover] = useState<AdminMapDto | null>(null);
  const [trashing, setTrashing] = useState<AdminMapDto | null>(null);
  const [purging, setPurging] = useState<AdminMapDto | null>(null);
  const maps = useQuery({
    queryKey: adminMapsKey,
    queryFn: () => api<AdminMapDto[]>(routes.adminMaps.list.path),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminMapsKey });
    void queryClient.invalidateQueries({ queryKey: mapsKey });
  };
  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: errorText(error, 'Try again.'), tone: 'danger' });
  const trash = useMutation({
    mutationFn: (m: AdminMapDto) =>
      api<void>(buildPath(routes.adminMaps.trash.path, { mapId: m.id }), { method: 'POST' }),
    onSuccess: (_, m) => {
      refresh();
      toast({ title: `${m.name} deleted`, description: 'You can restore it here.', tone: 'success' });
    },
    onError: failed('Could not delete the map'),
  });
  const restore = useMutation({
    mutationFn: (m: AdminMapDto) =>
      api<MapDto>(buildPath(routes.adminMaps.restore.path, { mapId: m.id }), { method: 'POST' }),
    onSuccess: (_, m) => {
      refresh();
      toast({ title: `${m.name} restored`, tone: 'success' });
    },
    onError: failed('Could not restore the map'),
  });

  const all = maps.data ?? [];
  const deleted = all.filter((m) => m.deletedAt !== null).length;
  const needle = query.trim().toLowerCase();
  const shown = all.filter(
    (m) =>
      (showDeleted || m.deletedAt === null) &&
      (!needle ||
        m.name.toLowerCase().includes(needle) ||
        m.slug.toLowerCase().includes(needle) ||
        (m.ownerName ?? '').toLowerCase().includes(needle)),
  );

  return (
    <Card>
      <CardHeader
        title="Maps"
        description="Every map on this instance and who owns it. Admins see that a map exists, never what is on it."
      />
      <CardBody>
        <div className={styles.inline}>
          <Input
            size="sm"
            icon={<Search />}
            placeholder="Filter by map or owner"
            aria-label="Filter maps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Switch
            checked={showDeleted}
            onCheckedChange={setShowDeleted}
            label={deleted > 0 ? `Show deleted (${deleted})` : 'Show deleted'}
          />
        </div>
      </CardBody>
      <CardBody flush>
        {maps.isPending ? (
          <SkeletonRows count={3} />
        ) : maps.isError ? (
          <ErrorState compact error={maps.error} onRetry={() => void maps.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={<MapIcon />}
            title={all.length === 0 ? 'No maps yet' : 'No map matches'}
            description={
              all.length === 0
                ? 'Maps people create show up here.'
                : 'Try another name, or show deleted maps.'
            }
          />
        ) : (
          <ul className={styles.list} aria-label="Maps">
            {shown.map((m) => (
              <li key={m.id} className={`${styles.item} ${styles.itemCenter}`}>
                <span className={styles.subjectIcon} aria-hidden>
                  <MapIcon />
                </span>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    {m.deletedAt === null ? (
                      <Link href={`/m/${encodeURIComponent(m.slug)}`}>{m.name}</Link>
                    ) : (
                      m.name
                    )}
                    <span className={`${styles.version} mono`}>{m.slug}</span>
                    {m.kind === 'composite' && <Badge variant="outline">Composite</Badge>}
                    {m.deletedAt !== null && (
                      <Badge tone="danger" dot>
                        Deleted {relativeTime(m.deletedAt)}
                      </Badge>
                    )}
                  </div>
                  <div className={styles.rowMeta}>
                    {m.ownerName ? `Owned by ${m.ownerName}` : 'Owner account is gone'}
                    {` · ${plural(m.systems, 'system')} · ${plural(m.rules, 'access rule')}`}
                    {` · changed ${relativeTime(m.updatedAt)}`}
                  </div>
                  {m.description && <div className={styles.rowMeta}>{m.description}</div>}
                </div>
                <div className={styles.rowActions}>
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton size="sm" label={`More for ${m.name}`} icon={<MoreHorizontal />} />
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<UserRound />} onSelect={() => setHandover(m)}>
                        Hand over…
                      </MenuItem>
                      {m.deletedAt === null ? (
                        <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setTrashing(m)}>
                          Delete
                        </MenuItem>
                      ) : (
                        <>
                          <MenuItem icon={<RotateCcw />} onSelect={() => restore.mutate(m)}>
                            Restore
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setPurging(m)}>
                            Delete for good…
                          </MenuItem>
                        </>
                      )}
                    </MenuContent>
                  </Menu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <HandOverDialog map={handover} onClose={() => setHandover(null)} onDone={refresh} />
      <ConfirmDialog
        open={trashing !== null}
        onOpenChange={(open) => !open && setTrashing(null)}
        title={`Delete ${trashing?.name ?? ''}?`}
        description="Nobody can open it until it is restored. You can restore it here, with everything on it."
        confirmLabel="Delete map"
        tone="danger"
        onConfirm={() => trashing && trash.mutateAsync(trashing)}
      />
      <PurgeDialog map={purging} onClose={() => setPurging(null)} onDone={refresh} />
    </Card>
  );
}

function HandOverDialog({
  map,
  onClose,
  onDone,
}: {
  map: AdminMapDto | null;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<AccountOption | null>(null);
  const transfer = useMutation({
    mutationFn: ({ mapId, accountId }: { mapId: string; accountId: string }) =>
      api<MapDto>(buildPath(routes.adminMaps.transferOwner.path, { mapId }), {
        method: 'PUT',
        json: { accountId },
      }),
    onSuccess: (data) => {
      onDone();
      toast({ title: `${picked?.label ?? 'The new owner'} now owns ${data.name}`, tone: 'success' });
      close();
    },
  });
  const close = () => {
    setPicked(null);
    transfer.reset();
    onClose();
  };
  return (
    <Dialog open={map !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        title={`Hand over ${map?.name ?? ''}`}
        description="The new owner becomes its admin. The current owner keeps only what access rules give them."
        width={440}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              loading={transfer.isPending}
              disabled={!picked || picked.key === map?.ownerAccountId}
              onClick={() =>
                map && picked && transfer.mutate({ mapId: map.id, accountId: picked.account.id })
              }
            >
              Hand over
            </Button>
          </>
        }
      >
        <Field
          label="New owner"
          error={transfer.error ? errorText(transfer.error, 'Could not hand over the map.') : undefined}
        >
          <AccountPicker value={picked} onChange={setPicked} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

function PurgeDialog({ map, onClose, onDone }: { map: AdminMapDto | null; onClose(): void; onDone(): void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const purge = useMutation({
    mutationFn: (m: AdminMapDto) =>
      api<void>(buildPath(routes.adminMaps.purge.path, { mapId: m.id }), { method: 'DELETE' }),
    onSuccess: (_, m) => {
      onDone();
      toast({ title: `${m.name} is gone for good`, tone: 'success' });
      close();
    },
  });
  const close = () => {
    setTyped('');
    purge.reset();
    onClose();
  };
  return (
    <Dialog open={map !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        title={`Delete ${map?.name ?? ''} for good?`}
        description="Its systems, connections, signatures, access rules, links and webhooks go with it. This cannot be undone. Type its name to confirm."
        width={440}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={purge.isPending}
              disabled={!map || typed !== map.name}
              onClick={() => map && purge.mutate(map)}
            >
              Delete for good
            </Button>
          </>
        }
      >
        <Field
          label="Map name"
          error={purge.error ? errorText(purge.error, 'Could not delete the map.') : undefined}
        >
          <Input autoFocus placeholder={map?.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
