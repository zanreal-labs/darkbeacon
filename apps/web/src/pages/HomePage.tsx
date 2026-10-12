import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Map as MapIcon, Plus, Settings, Waypoints } from 'lucide-react';
import { routes, type CreateMapRequest, type MapDto, type MapSummaryDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { mapPermissions } from '../lib/roles';
import { useDemoMode } from '../lib/session';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Page,
  PageHeader,
  Skeleton,
  Stack,
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

const ROLE_NAME = { admin: 'Admin', manager: 'Manager', member: 'Member', viewer: 'Viewer' } as const;

export const ROLE_TONE = {
  admin: 'accent',
  manager: 'accent',
  member: 'neutral',
  viewer: 'neutral',
} as const;

export function HomePage() {
  useBreadcrumbs([{ label: 'Maps' }]);
  const demo = useDemoMode();
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  const [creating, setCreating] = useState(false);
  const newMap = (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New map
    </Button>
  );

  return (
    <Page width={880}>
      <PageHeader
        title="Maps"
        description="Every chain you can see. Open one to map live with your group."
        actions={maps.data && maps.data.length > 0 ? newMap : undefined}
      />
      <Stack>
        {demo && (
          <Callout tone="accent" title="You're exploring the demo">
            Everyone on this instance shares the demo account, so changes you make are visible to others.
          </Callout>
        )}
        {maps.isPending ? (
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
            <ul className={styles.list} aria-label="Maps">
              {maps.data.map((m) => (
                <MapRow key={m.id} map={m} />
              ))}
            </ul>
          </Card>
        )}
      </Stack>
      <CreateMapDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function MapRow({ map }: { map: MapSummaryDto }) {
  const can = mapPermissions(map.role);
  return (
    <li className={styles.item}>
      <Link to={`/m/${map.slug}`} className={styles.link}>
        <span className={styles.icon} aria-hidden>
          <Waypoints />
        </span>
        <span className={styles.main}>
          <span className={styles.name}>{map.name}</span>
          <span className={`${styles.slug} mono`}>/m/{map.slug}</span>
        </span>
        <Badge tone={ROLE_TONE[map.role]}>{ROLE_NAME[map.role]}</Badge>
        <ChevronRight className={styles.chevron} aria-hidden />
      </Link>
      {can.manage && (
        <IconButton asChild className={styles.settings} label={`Settings of ${map.name}`} icon={<Settings />}>
          <Link to={`/m/${map.slug}/settings`} />
        </IconButton>
      )}
    </li>
  );
}

function CreateMapDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const shownSlug = slug ?? slugify(name);

  const create = useMutation({
    mutationFn: (body: CreateMapRequest) =>
      api<MapDto>(routes.maps.create.path, { method: 'POST', json: body }),
    onSuccess: (map) => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      void navigate(`/m/${map.slug}`);
    },
  });

  const change = (next: boolean) => {
    if (!next) {
      setName('');
      setSlug(null);
      create.reset();
    }
    onOpenChange(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), ...(shownSlug.length >= 2 ? { slug: shownSlug } : {}) });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        title="New map"
        description="A map holds one chain: its systems, connections and signatures."
        width={440}
      >
        <form className={styles.form} onSubmit={submit} aria-label="New map">
          <Field label="Name">
            <Input
              required
              maxLength={64}
              autoFocus
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
          <div className={styles.formFooter}>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
              Create map
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
