'use client';

import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bell,
  Bookmark,
  Building2,
  Copy,
  Flag,
  Hash,
  KeyRound,
  Lock,
  Network,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  UserRound,
  Webhook,
  X,
} from 'lucide-react';
import {
  AccountPicker,
  BotHint,
  EvePicker,
  GuildSelect,
  RoleSelect,
  type AccountOption,
  type EveOption,
} from '../components/pickers';
import { useInstance } from '../lib/maps';
import { useMe } from '../lib/session';
import { DiscordNotifications } from './MapNotifications';
import { MapSharing } from './MapSharing';
import {
  AccessSubjectKind,
  buildPath,
  MapRole,
  MapScope,
  routes,
  type AccessRuleDto,
  type CreateAccessRuleRequest,
  type CreatedWebhookDto,
  type LabelDto,
  type MapDto,
  type MapSummaryDto,
  type UpdateMapRequest,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { mapPermissions } from '../lib/roles';
import { relativeTime } from '../lib/time';
import { useTabParam } from '../lib/useTabParam';
import { BookmarkLabelSettings } from '../map/BookmarkSettings';
import { PluginSlot } from '../plugins/PluginSlot';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
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
  Select,
  Skeleton,
  SkeletonRows,
  Stack,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  useToast,
} from '../ui';
import { Redirect } from '../components/Redirect';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

type TabId = 'general' | 'labels' | 'bookmarks' | 'access' | 'sharing' | 'notifications';

/** Map settings while they load (also the server's Suspense fallback). */
export function MapSettingsSkeleton() {
  return (
    <Page width={880} aria-busy="true">
      <Skeleton width={220} height={24} />
      <Skeleton width={320} height={14} style={{ marginTop: 10 }} />
      <Skeleton width="100%" height={36} style={{ margin: '32px 0 24px' }} />
      <Skeleton width="100%" height={220} radius={10} />
    </Page>
  );
}

/** Settings of the map at `/m/<slug>/settings`; the server renders it with the map already loaded. */
export function MapSettingsPage({ slug }: { slug: string }) {
  const map = useQuery({
    queryKey: ['map', slug],
    queryFn: () => api<MapDto>(buildPath(routes.maps.bySlug.path, { slug })),
    retry: false,
  });
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  const can = mapPermissions(maps.data?.find((m) => m.id === map.data?.id)?.role);
  const tabs: { id: TabId; title: string; icon: ReactNode; show: boolean }[] = [
    { id: 'general', title: 'General', icon: <Settings2 />, show: can.admin },
    { id: 'labels', title: 'Labels', icon: <Tags />, show: can.manage },
    { id: 'bookmarks', title: 'Bookmark labels', icon: <Bookmark />, show: can.manage },
    { id: 'access', title: 'Access', icon: <ShieldCheck />, show: can.admin },
    { id: 'sharing', title: 'Sharing', icon: <Network />, show: can.admin },
    { id: 'notifications', title: 'Notifications', icon: <Bell />, show: can.admin },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useTabParam<TabId>(
    visible.map((t) => t.id),
    visible[0]?.id ?? 'labels',
  );

  if (map.isPending || maps.isPending) return <MapSettingsSkeleton />;
  if (map.isError) {
    const missing = map.error instanceof ApiError && map.error.status === 404;
    return (
      <Page width={880}>
        {missing ? (
          <EmptyState
            icon={<Lock />}
            title="This map is not available"
            description={`There is no map “${slug}”, or you cannot see it.`}
            actions={
              <Button asChild>
                <Link href="/maps">All maps</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="Settings could not be loaded"
            error={map.error}
            onRetry={() => void map.refetch()}
          />
        )}
      </Page>
    );
  }
  if (!can.manage) return <Redirect to={`/m/${slug}`} />;

  return (
    <Page width={880}>
      <PageHeader
        title={map.data.name}
        description="Map settings"
        actions={
          <Button asChild trailingIcon={<ArrowUpRight />}>
            <Link href={`/m/${map.data.slug}`}>Open map</Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={styles.tabs} aria-label="Map settings sections">
          {visible.map((t) => (
            <TabsTrigger key={t.id} value={t.id} icon={t.icon}>
              {t.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {can.admin && (
          <TabsContent value="general">
            <Stack>
              <GeneralSettings map={map.data} />
              <PluginSlot slot="settingsPage" props={{ mapId: map.data.id }} />
              <DeleteMap map={map.data} />
            </Stack>
          </TabsContent>
        )}
        <TabsContent value="labels">
          <LabelSettings key={map.data.id} map={map.data} />
        </TabsContent>
        <TabsContent value="bookmarks">
          <BookmarkLabelSettings key={map.data.id} map={map.data} canManage={can.manage} />
        </TabsContent>
        {can.admin && (
          <TabsContent value="access">
            <AccessRules map={map.data} />
          </TabsContent>
        )}
        {can.admin && (
          <TabsContent value="sharing">
            <MapSharing map={map.data} />
          </TabsContent>
        )}
        {can.admin && (
          <TabsContent value="notifications">
            <Stack>
              <DiscordNotifications map={map.data} />
              <Webhooks map={map.data} />
            </Stack>
          </TabsContent>
        )}
      </Tabs>
    </Page>
  );
}

function useMapUpdated() {
  const queryClient = useQueryClient();
  return (map: MapDto) => {
    queryClient.setQueryData(['map', map.slug], map);
    void queryClient.invalidateQueries({ queryKey: ['maps'] });
  };
}

// ---- General ----------------------------------------------------------------------------------

const SCOPES: Record<MapScope, { label: string; hint: string }> = {
  wormhole: { label: 'Wormhole space', hint: 'J-space, Thera and the shattered systems' },
  high: { label: 'High-sec', hint: 'Security 0.5 and above' },
  low: { label: 'Low-sec', hint: 'Security 0.1 to 0.4' },
  null: { label: 'Null-sec', hint: 'Security 0.0 and below' },
  pochven: { label: 'Pochven', hint: 'Triglavian space' },
};

function GeneralSettings({ map }: { map: MapDto }) {
  const router = useRouter();
  const toast = useToast();
  const updated = useMapUpdated();
  const [name, setName] = useState(map.name);
  const [slug, setSlug] = useState(map.slug);
  const [scopes, setScopes] = useState<MapScope[]>(map.settings.scopes);
  const dirty =
    name.trim() !== map.name ||
    slug !== map.slug ||
    scopes.length !== map.settings.scopes.length ||
    scopes.some((s) => !map.settings.scopes.includes(s));
  const save = useMutation({
    mutationFn: (body: UpdateMapRequest) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), { method: 'PATCH', json: body }),
    onSuccess: (next) => {
      updated(next);
      toast({ title: 'Map settings saved', tone: 'success' });
      if (next.slug !== map.slug) router.replace(`/m/${next.slug}/settings`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name: name.trim(), slug, settings: { scopes } });
  };

  return (
    <Card>
      <form onSubmit={submit} aria-label="General">
        <CardHeader title="General" description="The map's name, its address and what auto-mapping adds." />
        <CardBody>
          <div className={styles.formStack}>
            <div className={styles.grid}>
              <Field label="Name">
                <Input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label="Address"
                hint="Changing it breaks old links."
                error={save.error ? errorText(save.error, 'Could not save.') : undefined}
              >
                <Input
                  mono
                  required
                  minLength={2}
                  maxLength={48}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  icon={
                    <span className="mono subtle" style={{ paddingLeft: 4 }}>
                      /m/
                    </span>
                  }
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </Field>
            </div>
            <fieldset
              style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--dbk-space-2)' }}
            >
              <legend
                className="muted"
                style={{
                  fontSize: 'var(--dbk-font-size-small)',
                  fontWeight: 500,
                  marginBottom: 'var(--dbk-space-2)',
                }}
              >
                Auto-mapping adds systems in
              </legend>
              <div className={styles.grid} style={{ gap: 'var(--dbk-space-3)' }}>
                {MapScope.options.map((s) => (
                  <Checkbox
                    key={s}
                    checked={scopes.includes(s)}
                    onCheckedChange={(on) => setScopes(on ? [...scopes, s] : scopes.filter((x) => x !== s))}
                    label={SCOPES[s].label}
                    description={SCOPES[s].hint}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </CardBody>
        <CardFooter>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setName(map.name);
                setSlug(map.slug);
                setScopes(map.settings.scopes);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function DeleteMap({ map }: { map: MapDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () => api<void>(buildPath(routes.maps.remove.path, { mapId: map.id }), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      router.replace('/');
    },
  });
  return (
    <Card className={styles.danger}>
      <CardHeader
        title="Delete this map"
        description="Removes the map with its systems, connections, signatures, access rules and webhooks, for everyone. This cannot be undone."
        actions={
          <Button variant="danger" icon={<Trash2 />} onClick={() => setOpen(true)}>
            Delete map…
          </Button>
        }
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped('');
        }}
      >
        <DialogContent
          title={`Delete ${map.name}?`}
          description="Everyone loses this map at once. Type its name to confirm."
          width={440}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                disabled={typed !== map.name}
                onClick={() => remove.mutate()}
              >
                Delete map
              </Button>
            </>
          }
        >
          <Field
            label="Map name"
            error={remove.error ? errorText(remove.error, 'Could not delete the map.') : undefined}
          >
            <Input
              autoFocus
              placeholder={map.name}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- Labels -----------------------------------------------------------------------------------

const PALETTE = ['#38c6d6', '#3fbf7f', '#eba23b', '#f05252', '#7b93ff', '#b98cf5', '#f472b6', '#94a3b8'];
const newLabel = (n: number): LabelDto => ({
  id: crypto.randomUUID(),
  name: '',
  color: PALETTE[n % PALETTE.length]!,
  description: '',
});

function LabelSettings({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [labels, setLabels] = useState<LabelDto[]>(map.labels);
  const [saved, setSaved] = useState<LabelDto[]>(map.labels);
  const dirty = JSON.stringify(labels) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: (list: LabelDto[]) =>
      api<LabelDto[]>(buildPath(routes.maps.setLabels.path, { mapId: map.id }), {
        method: 'PUT',
        json: { labels: list },
      }),
    onSuccess: (list) => {
      setLabels(list);
      setSaved(list);
      queryClient.setQueryData(['map', map.slug], { ...map, labels: list });
      toast({ title: 'Labels saved', tone: 'success' });
    },
  });
  const change = (id: string, patch: Partial<LabelDto>) =>
    setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(labels.map((l) => ({ ...l, name: l.name.trim() })).filter((l) => l.name));
  };

  return (
    <Card>
      <form onSubmit={submit} aria-label="Labels">
        <CardHeader
          title="Labels"
          description="Tags for systems, like Staging or Sites. The description shows when someone hovers the label."
          actions={
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() => setLabels((ls) => [...ls, newLabel(ls.length)])}
              disabled={labels.length >= 64}
            >
              Add label
            </Button>
          }
        />
        <CardBody flush>
          {labels.length === 0 ? (
            <EmptyState
              compact
              icon={<Tags />}
              title="No labels yet"
              description="Add a few to mark staging systems, sites or exits on the map."
            />
          ) : (
            <div>
              {labels.map((l) => (
                <div key={l.id} className={styles.labelRow}>
                  <Tooltip content="Colour">
                    <label className={styles.swatch} style={{ background: l.color }}>
                      <input
                        type="color"
                        aria-label={`Colour of ${l.name || 'new label'}`}
                        value={l.color}
                        onChange={(e) => change(l.id, { color: e.target.value })}
                        style={{ opacity: 0 }}
                      />
                    </label>
                  </Tooltip>
                  <Input
                    aria-label="Label name"
                    placeholder="Name"
                    maxLength={32}
                    value={l.name}
                    onChange={(e) => change(l.id, { name: e.target.value })}
                  />
                  <Input
                    aria-label="Description"
                    placeholder="Description (optional)"
                    maxLength={500}
                    value={l.description}
                    onChange={(e) => change(l.id, { description: e.target.value })}
                  />
                  <IconButton
                    size="sm"
                    label={`Remove label ${l.name || 'new label'}`}
                    icon={<X />}
                    onClick={() => setLabels((ls) => ls.filter((x) => x.id !== l.id))}
                  />
                </div>
              ))}
            </div>
          )}
        </CardBody>
        <CardFooter>
          {labels.some((l) => l.name.trim()) && (
            <span className={styles.footerNote}>
              <span className={styles.preview}>
                {labels
                  .filter((l) => l.name.trim())
                  .map((l) => (
                    <span
                      key={l.id}
                      className={styles.labelPreview}
                      style={{ '--label-color': l.color } as CSSProperties}
                    >
                      {l.name}
                    </span>
                  ))}
              </span>
            </span>
          )}
          {save.error && <span className="error">{errorText(save.error, 'Could not save the labels.')}</span>}
          {dirty && (
            <Button variant="ghost" onClick={() => setLabels(saved)}>
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save labels
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---- Access -----------------------------------------------------------------------------------

const SUBJECT: Record<AccessSubjectKind, { label: string; icon: ReactNode; unknown: string }> = {
  corporation: { label: 'Corporation', icon: <Building2 />, unknown: 'A corporation ESI does not know' },
  alliance: { label: 'Alliance', icon: <Flag />, unknown: 'An alliance ESI does not know' },
  character: { label: 'Character', icon: <UserRound />, unknown: 'A character ESI does not know' },
  discordRole: { label: 'Discord role', icon: <Hash />, unknown: 'A Discord role the bot cannot see' },
  account: { label: 'Person', icon: <KeyRound />, unknown: 'An account that was removed' },
};

const ROLE_LABEL: Record<MapRole, string> = {
  viewer: 'Viewer',
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
  blocked: 'Blocked',
};

const ROLE_HINT: Record<MapRole, string> = {
  viewer: 'Sees the map',
  member: 'Maps systems and signatures',
  manager: 'Also locks systems and edits labels',
  admin: 'Also settings, access and notifications',
  blocked: 'Refused, whatever else matches',
};

type Subject =
  | { kind: 'character' | 'corporation' | 'alliance'; picked: EveOption | null }
  | { kind: 'account'; picked: AccountOption | null }
  | { kind: 'discordRole'; guildId: string | null; roleId: string | null };

function emptySubject(kind: AccessSubjectKind): Subject {
  if (kind === 'account') return { kind, picked: null };
  if (kind === 'discordRole') return { kind, guildId: null, roleId: null };
  return { kind, picked: null };
}

function subjectRequest(
  subject: Subject,
): Pick<CreateAccessRuleRequest, 'subjectKind' | 'subjectId' | 'guildId'> | null {
  switch (subject.kind) {
    case 'account':
      return subject.picked
        ? { subjectKind: 'account', subjectId: subject.picked.account.id, guildId: null }
        : null;
    case 'discordRole':
      return subject.guildId && subject.roleId
        ? { subjectKind: 'discordRole', subjectId: subject.roleId, guildId: subject.guildId }
        : null;
    default:
      return subject.picked
        ? { subjectKind: subject.kind, subjectId: String(subject.picked.entity.id), guildId: null }
        : null;
  }
}

function AccessRules({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const instance = useInstance();
  const key = ['access-rules', map.id];
  const rules = useQuery({
    queryKey: key,
    queryFn: () => api<AccessRuleDto[]>(buildPath(routes.access.list.path, { mapId: map.id })),
  });
  const discordRoles = instance.data?.discordRoles ?? false;
  const bot = instance.data?.discordBot ?? false;
  const kinds = AccessSubjectKind.options.filter((k) => k !== 'discordRole' || discordRoles);
  const [subject, setSubject] = useState<Subject>(emptySubject('corporation'));
  const [role, setRole] = useState<MapRole>('member');
  const [removing, setRemoving] = useState<AccessRuleDto | null>(null);
  const add = useMutation({
    mutationFn: (body: CreateAccessRuleRequest) =>
      api<AccessRuleDto>(buildPath(routes.access.add.path, { mapId: map.id }), {
        method: 'POST',
        json: body,
      }),
    onSuccess: (rule) => {
      setSubject(emptySubject(subject.kind));
      void queryClient.invalidateQueries({ queryKey: key });
      toast({
        title: `${rule.subject?.name ?? 'Rule'} added as ${ROLE_LABEL[rule.role].toLowerCase()}`,
        tone: 'success',
      });
    },
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      api<void>(buildPath(routes.access.remove.path, { mapId: map.id, ruleId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) =>
      toast({
        title: 'Could not remove the rule',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });

  const request = subjectRequest(subject);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (request) add.mutate({ ...request, role });
  };
  const admin = me.data?.account.instanceRole === 'owner' || me.data?.account.instanceRole === 'admin';

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Who can open this map"
          description="The highest matching rule wins. A blocked character or person is refused whatever else matches."
        />
        <CardBody flush>
          {rules.isPending ? (
            <SkeletonRows count={2} />
          ) : rules.isError ? (
            <ErrorState compact error={rules.error} onRetry={() => void rules.refetch()} />
          ) : rules.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Lock />}
              title="Only you can see this map"
              description={
                discordRoles
                  ? 'Add a rule below to let your corporation, alliance or a Discord role in.'
                  : 'Add a rule below to let your corporation, your alliance or a pilot in.'
              }
            />
          ) : (
            <ul className={styles.list}>
              {rules.data.map((r) => (
                <li key={r.id} className={`${styles.item} ${styles.itemCenter}`}>
                  {r.subject?.imageUrl ? (
                    <Avatar
                      src={r.subject.imageUrl}
                      name={r.subject.name}
                      size={32}
                      shape={
                        r.subjectKind === 'character' || r.subjectKind === 'account' ? 'circle' : 'rounded'
                      }
                    />
                  ) : (
                    <span className={styles.subjectIcon} aria-hidden>
                      {SUBJECT[r.subjectKind].icon}
                    </span>
                  )}
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {r.subject?.name ?? <span className="muted">{SUBJECT[r.subjectKind].unknown}</span>}
                      {r.subject?.detail && <span className={styles.version}>{r.subject.detail}</span>}
                    </div>
                    <div className={styles.rowMeta}>{SUBJECT[r.subjectKind].label}</div>
                  </div>
                  <div className={styles.rowActions}>
                    <Badge
                      tone={
                        r.role === 'blocked'
                          ? 'danger'
                          : r.role === 'admin' || r.role === 'manager'
                            ? 'accent'
                            : 'neutral'
                      }
                    >
                      {ROLE_LABEL[r.role]}
                    </Badge>
                    <IconButton
                      size="sm"
                      label={`Remove the rule for ${r.subject?.name ?? SUBJECT[r.subjectKind].label.toLowerCase()}`}
                      icon={<Trash2 />}
                      onClick={() => setRemoving(r)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <form onSubmit={submit} aria-label="Add access rule">
          <CardHeader title="Add a rule" description="Find them by name." />
          <CardBody>
            <div className={styles.ruleGrid}>
              <Field label="Who">
                <Select
                  value={subject.kind}
                  options={kinds.map((k) => ({ value: k, label: SUBJECT[k].label, icon: SUBJECT[k].icon }))}
                  onValueChange={(k) => {
                    add.reset();
                    setSubject(emptySubject(k as AccessSubjectKind));
                  }}
                />
              </Field>
              {subject.kind === 'account' ? (
                <Field
                  label="Person"
                  error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                >
                  <AccountPicker
                    value={subject.picked}
                    onChange={(picked) => setSubject({ kind: 'account', picked })}
                  />
                </Field>
              ) : subject.kind === 'discordRole' ? (
                bot ? (
                  <>
                    <Field label="Discord server">
                      <GuildSelect
                        value={subject.guildId}
                        onChange={(guildId) => setSubject({ kind: 'discordRole', guildId, roleId: null })}
                      />
                    </Field>
                    <Field
                      label="Role"
                      error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                    >
                      <RoleSelect
                        guildId={subject.guildId}
                        value={subject.roleId}
                        onChange={(roleId) => setSubject({ ...subject, roleId })}
                      />
                    </Field>
                  </>
                ) : (
                  <div className={styles.ruleWide}>
                    <Callout tone="neutral" title="Discord roles need the bot">
                      <BotHint admin={admin} />
                    </Callout>
                  </div>
                )
              ) : (
                <Field
                  label={SUBJECT[subject.kind].label}
                  error={add.error ? errorText(add.error, 'Could not add the rule.') : undefined}
                >
                  <EvePicker
                    category={subject.kind}
                    value={subject.picked}
                    onChange={(picked) => setSubject({ kind: subject.kind, picked } as Subject)}
                  />
                </Field>
              )}
              <Field label="Map role" hint={ROLE_HINT[role]}>
                <Select
                  value={role}
                  options={MapRole.options.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  onValueChange={(r) => setRole(r as MapRole)}
                />
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <Button
              type="submit"
              variant="primary"
              icon={<Plus />}
              loading={add.isPending}
              disabled={!request}
            >
              Add rule
            </Button>
          </CardFooter>
        </form>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove the rule for ${removing?.subject?.name ?? 'them'}?`}
        description="People who got in only through it lose access at once."
        confirmLabel="Remove rule"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing.id)}
      />
    </Stack>
  );
}

// ---- Webhooks ---------------------------------------------------------------------------------

const EVENT_GROUPS = [
  { value: 'system.*', label: 'Systems', hint: 'Added, changed, removed' },
  { value: 'connection.*', label: 'Connections', hint: 'Added, changed, removed, passages' },
  { value: 'signature.*', label: 'Signatures', hint: 'Added, changed, removed' },
  { value: 'character.*', label: 'Characters', hint: 'Jumps, ships, online' },
  { value: 'labels.changed', label: 'Labels', hint: 'The label list changed' },
  { value: 'map.*', label: 'Map', hint: 'Settings changed' },
  { value: 'access.*', label: 'Access', hint: 'Rules and roles' },
  { value: 'ping.*', label: 'Pings', hint: 'Created and removed' },
] as const;

function eventsLabel(events: readonly string[]): string[] {
  if (events.includes('*')) return ['All events'];
  return events.map((e) => EVENT_GROUPS.find((g) => g.value === e)?.label ?? e);
}

function Webhooks({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['webhooks', map.id];
  const hooks = useQuery({
    queryKey: key,
    queryFn: () => api<WebhookDto[]>(buildPath(routes.webhooks.list.path, { mapId: map.id })),
  });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhookDto | null>(null);
  const [removing, setRemoving] = useState<WebhookDto | null>(null);
  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: errorText(error, 'Try again.'), tone: 'danger' });
  const toggle = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<WebhookDto>(buildPath(routes.webhooks.update.path, { mapId: map.id, webhookId: w.id }), {
        method: 'PATCH',
        json: { enabled: !w.enabled },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: failed('Could not switch the webhook'),
  });
  const remove = useMutation({
    mutationFn: (w: WebhookDto) =>
      api<void>(buildPath(routes.webhooks.remove.path, { mapId: map.id, webhookId: w.id }), {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: failed('Could not delete the webhook'),
  });

  return (
    <Stack>
      {created && (
        <Callout tone="success" title="Webhook created. Copy its signing secret now">
          <div style={{ display: 'grid', gap: 'var(--dbk-space-2)', marginTop: 'var(--dbk-space-1)' }}>
            It is shown only once. Use it to check the <code>x-darkbeacon-signature</code> header.
            <SecretValue value={created.secret} />
            <div>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                I saved it
              </Button>
            </div>
          </div>
        </Callout>
      )}
      <Card>
        <CardHeader
          title="Webhooks"
          description="Send chosen map events to another service as signed JSON, with retries."
          actions={
            hooks.data &&
            hooks.data.length > 0 && (
              <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                Add webhook
              </Button>
            )
          }
        />
        <CardBody flush>
          {hooks.isPending ? (
            <SkeletonRows count={2} avatar={false} />
          ) : hooks.isError ? (
            <ErrorState compact error={hooks.error} onRetry={() => void hooks.refetch()} />
          ) : hooks.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Webhook />}
              title="No webhooks"
              description="Post map events to your own service: a bot, an alert pipeline, a spreadsheet."
              actions={
                <Button icon={<Plus />} onClick={() => setCreating(true)}>
                  Add webhook
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {hooks.data.map((w) => (
                <WebhookRow
                  key={w.id}
                  map={map}
                  hook={w}
                  onToggle={() => toggle.mutate(w)}
                  onRemove={() => setRemoving(w)}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <CreateWebhookDialog
        map={map}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(hook) => {
          setCreated(hook);
          void queryClient.invalidateQueries({ queryKey: key });
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this webhook?"
        description="Deliveries stop at once and its delivery log is removed."
        confirmLabel="Delete webhook"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing)}
      />
    </Stack>
  );
}

function SecretValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className={styles.secret}>
      <code className="mono">{value}</code>
      <IconButton
        size="sm"
        label="Copy secret"
        icon={<Copy />}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast({ title: 'Secret copied', tone: 'success' }))
            .catch(() => {})
        }
      />
    </div>
  );
}

const DELIVERY_TONE = { delivered: 'success', failed: 'danger', pending: 'warning' } as const;

function WebhookRow({
  map,
  hook,
  onToggle,
  onRemove,
}: {
  map: MapDto;
  hook: WebhookDto;
  onToggle(): void;
  onRemove(): void;
}) {
  const toast = useToast();
  const [showLog, setShowLog] = useState(false);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', hook.id],
    queryFn: () =>
      api<WebhookDeliveryDto[]>(
        buildPath(routes.webhooks.deliveries.path, { mapId: map.id, webhookId: hook.id }),
      ),
    enabled: showLog,
  });
  const test = useMutation({
    mutationFn: () =>
      api<WebhookDeliveryDto>(buildPath(routes.webhooks.test.path, { mapId: map.id, webhookId: hook.id }), {
        method: 'POST',
      }),
    onSuccess: (d) => {
      toast(
        d.status === 'delivered'
          ? {
              title: 'Test delivered',
              description: `The endpoint answered ${d.responseCode}.`,
              tone: 'success',
            }
          : {
              title: 'Test failed',
              description: d.error ?? `The endpoint answered ${d.responseCode}.`,
              tone: 'danger',
            },
      );
      if (showLog) void deliveries.refetch();
    },
    onError: (error) =>
      toast({ title: 'Test failed', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  return (
    <li className={styles.item}>
      <span className={styles.subjectIcon} aria-hidden>
        <Webhook />
      </span>
      <div className={styles.rowBody}>
        <div className={styles.url} title={hook.url}>
          {hook.url}
        </div>
        <div className={styles.chips}>
          {eventsLabel(hook.events).map((e) => (
            <Badge key={e} variant="outline">
              {e}
            </Badge>
          ))}
        </div>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowLog((s) => !s)} style={{ marginLeft: -8 }}>
            {showLog ? 'Hide deliveries' : 'Recent deliveries'}
          </Button>
        </div>
        {showLog &&
          (deliveries.isPending ? (
            <Skeleton width="80%" height={12} />
          ) : deliveries.data && deliveries.data.length > 0 ? (
            <ul className={styles.deliveries}>
              {deliveries.data.slice(0, 10).map((d) => (
                <li key={d.id} className={styles.delivery}>
                  <Badge tone={DELIVERY_TONE[d.status]} dot>
                    {d.status}
                  </Badge>
                  <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.eventType}
                  </span>
                  <span className="mono muted">{d.responseCode ?? '—'}</span>
                  <span className="subtle">{relativeTime(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 'var(--dbk-font-size-small)' }}>
              Nothing sent yet.
            </p>
          ))}
      </div>
      <div className={styles.rowActions}>
        <Button size="sm" icon={<Send />} loading={test.isPending} onClick={() => test.mutate()}>
          Test
        </Button>
        <Switch
          checked={hook.enabled}
          onCheckedChange={onToggle}
          label={<span className="sr-only">Deliver to {hook.url}</span>}
        />
        <IconButton size="sm" label="Delete webhook" icon={<Trash2 />} onClick={onRemove} />
      </div>
    </li>
  );
}

function CreateWebhookDialog({
  map,
  open,
  onOpenChange,
  onCreated,
}: {
  map: MapDto;
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(hook: CreatedWebhookDto): void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['system.*', 'connection.*']);
  const create = useMutation({
    mutationFn: () =>
      api<CreatedWebhookDto>(buildPath(routes.webhooks.create.path, { mapId: map.id }), {
        method: 'POST',
        json: { url: url.trim(), events },
      }),
    onSuccess: (hook) => {
      onCreated(hook);
      change(false);
    },
  });
  const change = (next: boolean) => {
    if (!next) {
      setUrl('');
      setEvents(['system.*', 'connection.*']);
      create.reset();
    }
    onOpenChange(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        title="Add webhook"
        description="Events are posted as JSON and signed with a secret you get next."
        width={520}
      >
        <form id="new-webhook" onSubmit={submit} className={styles.formStack}>
          <Field
            label="Endpoint URL"
            error={create.error ? errorText(create.error, 'Could not add the webhook.') : undefined}
          >
            <Input
              mono
              required
              type="url"
              autoFocus
              placeholder="https://example.com/hooks/darkbeacon"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend
              className="muted"
              style={{
                fontSize: 'var(--dbk-font-size-small)',
                fontWeight: 500,
                marginBottom: 'var(--dbk-space-2)',
              }}
            >
              Events
            </legend>
            <div className={styles.eventPicker}>
              {EVENT_GROUPS.map((g) => (
                <Checkbox
                  key={g.value}
                  checked={events.includes(g.value)}
                  onCheckedChange={(on) =>
                    setEvents((list) => (on ? [...list, g.value] : list.filter((x) => x !== g.value)))
                  }
                  label={g.label}
                  description={g.hint}
                />
              ))}
            </div>
          </fieldset>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--dbk-space-2)' }}>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!url.trim() || events.length === 0}
            >
              Add webhook
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
