'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Import,
  Map as MapIcon,
  Plus,
  Settings,
  Star,
  Waypoints,
} from 'lucide-react';
import {
  MAP_EXPORT_FORMAT,
  routes,
  type CreateMapRequest,
  type EveEntityDto,
  type ImportMapResultDto,
  type MapDto,
  type MapSummaryDto,
} from '@darkbeacon/shared';
import { MAP_FILE_TYPE, readJsonFile } from '../lib/map-files';
import { api, ApiError } from '../lib/api';
import { mapSettingsHref } from '../lib/map-settings';
import { useOnlineCounts } from '../lib/characters';
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
  Checkbox,
  Dialog,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
  Stack,
  StatusDot,
  useToast,
} from '../ui';
import { usePageView } from '../lib/useTelemetry';
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
  usePageView('maps');
  const demo = useDemoMode();
  const maps = useMaps();
  const mayCreate = useMayCreateMaps();
  const [creating, setCreating] = useState(false);
  const newMap = mayCreate && (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New map
    </Button>
  );
  const importMap = mayCreate && <ImportMenu />;

  return (
    <Page width={880}>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          maps.data && maps.data.length > 0 ? (
            <>
              {importMap}
              {newMap}
            </>
          ) : undefined
        }
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
              description={
                mayCreate
                  ? 'Create a map for your chain, bring one over from Wanderer or a map file, or ask a map admin to give you access to theirs.'
                  : 'Only instance admins create maps here. Ask a map admin to give you access to theirs.'
              }
              actions={
                <>
                  {importMap}
                  {newMap}
                </>
              }
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
  const online = useOnlineCounts();
  return (
    <ul className={styles.list} aria-label="Maps">
      {maps.map((m) => (
        <MapRow
          key={m.id}
          map={m}
          online={online.data?.counts[m.id] ?? 0}
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
  online,
  starred,
  instanceDefault,
  lastOpened,
  onStar,
}: {
  map: MapSummaryDto;
  /** Tracked characters online on the map. */
  online: number;
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
          {map.description && (
            <span className={styles.description} title={map.description}>
              {map.description}
            </span>
          )}
          {(starred || instanceDefault || lastOpened) && (
            <span className={styles.meta}>
              {starred ? 'Opens first for you' : instanceDefault ? 'Opens first for everyone' : 'Opened last'}
            </span>
          )}
        </span>
        {online > 0 && (
          <span
            className={styles.online}
            title={`${online} tracked ${online === 1 ? 'character' : 'characters'} online`}
          >
            <StatusDot color="var(--dbk-color-success)" />
            {online}
            <span className="sr-only"> online</span>
          </span>
        )}
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
            <Link href={mapSettingsHref(map.slug)} />
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
  const mayCreate = useMayCreateMaps();
  return (
    <Page width={560}>
      <div className={styles.first}>
        <span className={styles.firstIcon} aria-hidden>
          <Waypoints />
        </span>
        <h1>Map your first chain</h1>
        <p className="muted">
          A map holds one chain: its systems, connections and signatures, live for everyone on it.{' '}
          {mayCreate
            ? 'Nobody has given you access to a map yet, so start your own.'
            : 'Nobody has given you access to a map yet, and only instance admins create maps here: ask a map admin to let you in.'}
        </p>
      </div>
      {mayCreate && (
        <Card>
          <div className={styles.firstForm}>
            <CreateMapForm autoFocus />
          </div>
        </Card>
      )}
      {mayCreate && (
        <div className={styles.firstImport}>
          <span className="muted">Already mapping somewhere else? Bring the whole map over.</span>
          <ImportMenu />
        </div>
      )}
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
  const [composite, setComposite] = useState(false);
  const [description, setDescription] = useState('');
  const [starter, setStarter] = useState<string>(NO_STARTER);
  const groups = useMyGroups();
  const shownSlug = slug ?? slugify(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const group = groups.find((g) => g.value === starter);
    create.mutate({
      name: name.trim(),
      ...(shownSlug.length >= 2 ? { slug: shownSlug } : {}),
      ...(composite ? { kind: 'composite' as const } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(group
        ? { starterRule: { subjectKind: group.kind, subjectId: String(group.id), role: 'member' } }
        : {}),
    });
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
      <Field label="Description" hint="Optional. Shown on the maps page.">
        <Input
          maxLength={1000}
          placeholder="Home chain of our corporation"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {groups.length > 0 && (
        <Field label="Who else gets in" hint="A first access rule; change it later in the map's settings.">
          <Select
            value={starter}
            onValueChange={setStarter}
            options={[
              { value: NO_STARTER, label: 'Only me for now' },
              ...groups.map((g) => ({ value: g.value, label: `${g.label} as members` })),
            ]}
          />
        </Field>
      )}
      <Checkbox
        checked={composite}
        onCheckedChange={setComposite}
        label="Composite (merge other maps)"
        description="No systems of its own: it shows the maps shared with it as one chain, e.g. an alliance chain."
      />
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

/** Whether this person may create maps (the instance may let only its admins). */
function useMayCreateMaps(): boolean {
  const instance = useInstance();
  const me = useMe();
  if (instance.data?.mapCreation !== 'admins') return true;
  const role = me.data?.account.instanceRole;
  return role === 'admin' || role === 'owner';
}

const NO_STARTER = '__none__';

/** The corporations and alliances of the person's characters, by name, for a starter rule. */
function useMyGroups(): Array<{
  value: string;
  kind: 'corporation' | 'alliance';
  id: number;
  label: string;
}> {
  const me = useMe();
  const characters = me.data?.characters ?? [];
  const main = characters.find((c) => c.id === me.data?.account.mainCharacterId) ?? characters[0];
  const ordered = main ? [main, ...characters.filter((c) => c !== main)] : characters;
  const corporations = [...new Set(ordered.map((c) => c.corporationId))];
  const alliances = [...new Set(ordered.flatMap((c) => (c.allianceId ? [c.allianceId] : [])))];
  const ids = [...corporations, ...alliances];
  const names = useQuery({
    queryKey: ['eve-entities', ids.join(',')],
    queryFn: () => api<EveEntityDto[]>(`${routes.eve.entities.path}?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
  });
  const name = (id: number, fallback: string) => {
    const entity = names.data?.find((e) => e.id === id);
    return entity ? `${entity.name}${entity.ticker ? ` [${entity.ticker}]` : ''}` : fallback;
  };
  return [
    ...alliances.map((id) => ({
      value: `alliance:${id}`,
      kind: 'alliance' as const,
      id,
      label: name(id, 'My alliance'),
    })),
    ...corporations.map((id) => ({
      value: `corporation:${id}`,
      kind: 'corporation' as const,
      id,
      label: name(id, 'My corporation'),
    })),
  ];
}

/**
 * "Import": a map from Wanderer (the import page), or a Darkbeacon map file that becomes a new
 * map of the person's own.
 */
function ImportMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const document = await readJsonFile<{ format?: string }>(file);
      if (document?.format !== MAP_EXPORT_FORMAT) throw new Error('This is not a Darkbeacon map file.');
      return api<ImportMapResultDto>(routes.mapFiles.import.path, {
        method: 'POST',
        json: { document },
        // Files can be larger than an ordinary request may be.
        headers: { 'content-type': MAP_FILE_TYPE },
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mapsKey });
      toast({
        title: `${result.map.name} imported`,
        description: `${result.systems} systems, ${result.connections} connections, ${result.signatures} signatures${
          result.skippedSystems.length ? `; ${result.skippedSystems.length} unknown systems left out` : ''
        }`,
        tone: 'success',
      });
      router.push(`/m/${result.map.slug}`);
    },
    onError: (error) =>
      toast({
        title: 'Could not import the map',
        description: error instanceof Error ? error.message : 'Try again.',
        tone: 'danger',
      }),
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Map file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importFile.mutate(file);
          e.target.value = '';
        }}
      />
      <Menu>
        <MenuTrigger asChild>
          <Button icon={<Import />} trailingIcon={<ChevronDown />} loading={importFile.isPending}>
            Import
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Import />} onSelect={() => router.push('/import')}>
            From Wanderer…
          </MenuItem>
          <MenuItem icon={<FileUp />} onSelect={() => input.current?.click()}>
            Darkbeacon map file…
          </MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}
