'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Map as MapIcon, Plus, Settings, Star, Waypoints } from 'lucide-react';
import { routes, type CreateMapRequest, type MapDto, type MapSummaryDto } from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { useInstance, useMaps, useSetDefaultMap } from '../lib/maps';
import { mapsKey } from '../lib/session-keys';
import { mapPermissions } from '../lib/roles';
import { useDemoMode, useMe } from '../lib/session';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Page,
  PageHeader,
  Skeleton,
  Spinner,
  Stack,
  useToast,
} from '../ui';
import styles from './HomePage.module.css';

/** `My Chain 2` -> `my-chain-2`; the server validates again. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export const ROLE_NAME = { admin: 'Admin', manager: 'Manager', member: 'Member', viewer: 'Viewer' } as const;

export const ROLE_TONE = {
  admin: 'accent',
  manager: 'accent',
  member: 'neutral',
  viewer: 'neutral',
} as const;

const TITLE = 'All maps';
const DESCRIPTION = 'Every chain you can see. Star the one Darkbeacon should open for you.';

function MapListSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading maps">
      <ul className={styles.list}>
        {[0, 1, 2].map((i) => (
          <li key={i} className={styles.skeletonRow}>
            <Skeleton width={36} height={36} radius={8} />
            <span className={styles.skeletonText}>
              <Skeleton width={`${40 - i * 8}%`} height={12} />
              <Skeleton width={`${22 + i * 4}%`} height={10} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The maps page as it looks while the list streams in (part of the prerendered shell). */
export function MapsPageSkeleton() {
  return (
    <Page width={880}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <MapListSkeleton />
    </Page>
  );
}

/** `/` while it finds the map to open (the proxy usually redirects before this shows). */
export function LandingSkeleton() {
  return (
    <div className={styles.landing} aria-busy="true">
      <Spinner label="Opening your map" />
      <span className="muted">Opening your map…</span>
    </div>
  );
}

/** `/maps`: every map the account can see, with a star for the one `/` opens. */
export function MapsPage() {
  useBreadcrumbs([{ label: TITLE }]);
  const demo = useDemoMode();
  const maps = useMaps();
  const [creating, setCreating] = useState(false);
  const newMap = (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New map
    </Button>
  );

  return (
    <Page width={880}>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={maps.data && maps.data.length > 0 ? newMap : undefined}
      />
      <Stack>
        {demo && (
          <Callout tone="accent" title="You're exploring the demo">
            Everyone on this instance shares the demo account, so changes you make are visible to others.
          </Callout>
        )}
        {maps.isPending ? (
          <MapListSkeleton />
        ) : maps.isError ? (
          <Card>
            <ErrorState
              title="Maps could not be loaded"
              error={maps.error}
              onRetry={() => void maps.refetch()}
            />
          </Card>
        ) : maps.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MapIcon />}
              title="No maps yet"
              description="Create a map for your chain, or ask a map admin to give you access to theirs."
              actions={newMap}
            />
          </Card>
        ) : (
          <Card>
            <MapList maps={maps.data} />
          </Card>
        )}
      </Stack>
      <CreateMapDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function MapList({ maps }: { maps: MapSummaryDto[] }) {
  const me = useMe();
  const instance = useInstance();
  const star = useSetDefaultMap();
  const toast = useToast();
  const mine = me.data?.account.defaultMapId ?? null;
  const fallback = instance.data?.defaultMapId ?? null;
  return (
    <ul className={styles.list} aria-label="Maps">
      {maps.map((m) => (
        <MapRow
          key={m.id}
          map={m}
          starred={mine === m.id}
          instanceDefault={!mine && fallback === m.id}
          lastOpened={me.data?.account.recentMapIds?.[0] === m.id}
          onStar={() =>
            star.mutate(mine === m.id ? null : m.id, {
              onSuccess: () =>
                toast({
                  title: mine === m.id ? 'No default map' : `${m.name} opens first`,
                  description:
                    mine === m.id ? 'Darkbeacon opens the map you used last.' : 'It is your default map now.',
                  tone: 'success',
                }),
            })
          }
        />
      ))}
    </ul>
  );
}

function MapRow({
  map,
  starred,
  instanceDefault,
  lastOpened,
  onStar,
}: {
  map: MapSummaryDto;
  starred: boolean;
  instanceDefault: boolean;
  lastOpened: boolean;
  onStar(): void;
}) {
  const can = mapPermissions(map.role);
  return (
    <li className={styles.item}>
      <Link href={`/m/${map.slug}`} className={styles.link}>
        <span className={styles.icon} aria-hidden>
          <Waypoints />
        </span>
        <span className={styles.main}>
          <span className={styles.name}>{map.name}</span>
          {(starred || instanceDefault || lastOpened) && (
            <span className={styles.meta}>
              {starred ? 'Opens first for you' : instanceDefault ? 'Opens first for everyone' : 'Opened last'}
            </span>
          )}
        </span>
        <Badge tone={ROLE_TONE[map.role]}>{ROLE_NAME[map.role]}</Badge>
        <ChevronRight className={styles.chevron} aria-hidden />
      </Link>
      <span className={styles.rowActions}>
        <IconButton
          size="sm"
          className={starred ? styles.starred : undefined}
          aria-pressed={starred}
          label={starred ? `${map.name} is your default map` : `Open ${map.name} first`}
          icon={<Star />}
          onClick={onStar}
        />
        {can.manage && (
          <IconButton asChild size="sm" label={`Settings of ${map.name}`} icon={<Settings />}>
            <Link href={`/m/${map.slug}/settings`} />
          </IconButton>
        )}
      </span>
    </li>
  );
}

/** `/` when the account can see no map yet: make the first one, right here. */
export function FirstMapPage() {
  useBreadcrumbs([{ label: 'New map' }]);
  const demo = useDemoMode();
  return (
    <Page width={560}>
      <div className={styles.first}>
        <span className={styles.firstIcon} aria-hidden>
          <Waypoints />
        </span>
        <h1>Map your first chain</h1>
        <p className="muted">
          A map holds one chain: its systems, connections and signatures, live for everyone on it. Nobody has
          given you access to a map yet, so start your own.
        </p>
      </div>
      <Card>
        <div className={styles.firstForm}>
          <CreateMapForm autoFocus />
        </div>
      </Card>
      {demo && (
        <p className={`${styles.firstNote} muted`}>
          In the demo every visitor shares one account, so others see your map too.
        </p>
      )}
    </Page>
  );
}

function useCreateMap() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (body: CreateMapRequest) =>
      api<MapDto>(routes.maps.create.path, { method: 'POST', json: body }),
    onSuccess: (map) => {
      void queryClient.invalidateQueries({ queryKey: mapsKey });
      router.push(`/m/${map.slug}`);
    },
  });
}

function CreateMapForm({ autoFocus, onCancel }: { autoFocus?: boolean; onCancel?: () => void }) {
  const create = useCreateMap();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const shownSlug = slug ?? slugify(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), ...(shownSlug.length >= 2 ? { slug: shownSlug } : {}) });
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-label="New map">
      <Field label="Name">
        <Input
          required
          maxLength={64}
          autoFocus={autoFocus}
          placeholder="Home chain"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label="Address"
        hint="Letters, numbers and dashes."
        error={
          create.error instanceof ApiError
            ? create.error.message
            : create.error
              ? 'Could not create the map.'
              : undefined
        }
      >
        <Input
          mono
          maxLength={48}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          icon={<span className={`${styles.prefix} mono`}>/m/</span>}
          placeholder="home-chain"
          value={shownSlug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </Field>
      <div className={styles.formActions}>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
          Create map
        </Button>
      </div>
    </form>
  );
}

/** The "New map" dialog, opened from All maps and from the map switcher. */
export function CreateMapDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New map"
        description="A map holds one chain: its systems, connections and signatures."
        width={440}
      >
        {/* Remounted on every open, so it starts empty. */}
        {open && <CreateMapForm autoFocus onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
