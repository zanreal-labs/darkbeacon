import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, MoreHorizontal, Package, Palette, Plus, Puzzle, Server, Trash2, Users } from 'lucide-react';
import {
  buildPath,
  routes,
  type AdminAccountDto,
  type CatalogEntryDto,
  type InstanceSettingsDto,
  type PluginDto,
  type ThemeDto,
  type ThemesDto,
  type UpdateInstanceRoleRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useMe } from '../lib/session';
import { relativeTime } from '../lib/time';
import { useTabParam } from '../lib/useTabParam';
import { PluginSlot } from '../plugins/PluginSlot';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import { ThemePicker } from '../theme/ThemePicker';
import { useTheme } from '../theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
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
  SkeletonRows,
  Stack,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const TABS = [
  { id: 'instance', title: 'Instance', icon: <Server /> },
  { id: 'people', title: 'People', icon: <Users /> },
  { id: 'plugins', title: 'Plugins', icon: <Puzzle /> },
  { id: 'themes', title: 'Themes', icon: <Palette /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function AdminPage() {
  useBreadcrumbs([{ label: 'Admin' }]);
  const [tab, setTab] = useTabParam<TabId>(
    TABS.map((t) => t.id),
    'instance',
  );
  return (
    <Page width={880}>
      <PageHeader
        title="Admin"
        description="Settings for this instance, the people on it, plugins and themes."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={styles.tabs} aria-label="Admin sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} icon={t.icon}>
              {t.title}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="instance">
          <InstanceTab />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab />
        </TabsContent>
        <TabsContent value="plugins">
          <PluginsTab />
        </TabsContent>
        <TabsContent value="themes">
          <ThemesTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

// ---- Instance ---------------------------------------------------------------------------------

function useInstanceSettings() {
  return useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
}

function InstanceTab() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string; version: string; database: string }>(routes.health.path),
  });
  const fact = (label: string, value: ReactNode) => (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{health.isPending ? <Skeleton width="60%" height={14} /> : value}</dd>
    </div>
  );
  return (
    <Stack>
      <Card>
        <CardHeader title="This instance" description="What is running and where it keeps its data." />
        <CardBody>
          {health.isError ? (
            <ErrorState compact error={health.error} onRetry={() => void health.refetch()} />
          ) : (
            <dl className={styles.facts}>
              {fact(
                'Status',
                <Badge tone={health.data?.status === 'ok' ? 'success' : 'warning'} dot>
                  {health.data?.status === 'ok' ? 'Healthy' : (health.data?.status ?? '')}
                </Badge>,
              )}
              {fact('Version', <span className="mono">{health.data?.version}</span>)}
              {fact(
                'Database',
                health.data?.database === 'postgres'
                  ? 'PostgreSQL'
                  : health.data?.database === 'sqlite'
                    ? 'SQLite'
                    : health.data?.database,
              )}
            </dl>
          )}
        </CardBody>
      </Card>
      <DiscordAdminSettings />
      <WebhookSettings />
      <PluginSlot slot="settingsPage" props={{ mapId: null }} />
    </Stack>
  );
}

/** Ids as typed in a text field: comma or space separated. */
const idList = (text: string) => text.split(/[\s,]+/).filter(Boolean);

function DiscordAdminSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useInstanceSettings();
  const [draft, setDraft] = useState<{ guild: string; roles: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: { adminGuildId: string | null; adminRoleIds: string[] }) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-settings'], data);
      setDraft(null);
      toast({ title: 'Discord admin roles saved', tone: 'success' });
    },
  });
  const value = draft ?? {
    guild: settings.data?.adminGuildId ?? '',
    roles: settings.data?.adminRoleIds.join(', ') ?? '',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ adminGuildId: value.guild.trim() || null, adminRoleIds: idList(value.roles) });
  };
  return (
    <Card>
      <form onSubmit={submit} aria-label="Discord admin roles">
        <CardHeader
          title="Admins from Discord"
          description="Members holding one of these roles on this Discord server become instance admins when they next sign in."
        />
        <CardBody>
          <div className={styles.grid}>
            <Field
              label="Discord server id"
              error={save.error ? errorText(save.error, 'Could not save.') : undefined}
            >
              <Input
                mono
                inputMode="numeric"
                placeholder="e.g. 81384788765712384"
                disabled={!settings.data}
                value={value.guild}
                onChange={(e) => setDraft({ ...value, guild: e.target.value })}
              />
            </Field>
            <Field label="Role ids" hint="Separate several with commas.">
              <Input
                mono
                placeholder="Role id, role id"
                disabled={!settings.data}
                value={value.roles}
                onChange={(e) => setDraft({ ...value, roles: e.target.value })}
              />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <span className={styles.footerNote}>Discord roles only ever add admin, never remove it.</span>
          {draft && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!draft}>
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function WebhookSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useInstanceSettings();
  const save = useMutation({
    mutationFn: (webhooksToPrivateNetworks: boolean) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, {
        method: 'PATCH',
        json: { webhooksToPrivateNetworks },
      }),
    onSuccess: (data) => queryClient.setQueryData(['admin-settings'], data),
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  return (
    <Card>
      <CardHeader title="Webhooks" description="Where map webhooks may send events." />
      <CardBody>
        <Switch
          checked={settings.data?.webhooksToPrivateNetworks ?? false}
          disabled={!settings.data || save.isPending}
          onCheckedChange={(on) => save.mutate(on)}
          label="Allow webhooks to private networks"
          description="Off by default: webhooks cannot reach this server, its local network or cloud metadata addresses. Turn it on only if every map admin may send requests into your network."
        />
      </CardBody>
    </Card>
  );
}

// ---- People -----------------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

function PeopleTab() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [handover, setHandover] = useState<AdminAccountDto | null>(null);
  const accounts = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: () => api<AdminAccountDto[]>(routes.admin.accounts.path),
  });
  const setRole = useMutation({
    mutationFn: ({ accountId, role }: { accountId: string; role: UpdateInstanceRoleRequest['role'] }) =>
      api<AdminAccountDto>(buildPath(routes.admin.setInstanceRole.path, { accountId }), {
        method: 'PUT',
        json: { role },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-accounts'] }),
    onError: (error) =>
      toast({
        title: 'Could not change the role',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });
  const transfer = useMutation({
    mutationFn: (accountId: string) =>
      api<void>(routes.admin.transferOwnership.path, { method: 'POST', json: { accountId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      void queryClient.invalidateQueries({ queryKey: meKey });
      toast({ title: 'Ownership handed over', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not hand over', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const isOwner = me.data?.account.instanceRole === 'owner';
  const myId = me.data?.account.id;

  return (
    <Card>
      <CardHeader
        title="People"
        description="Everyone who has signed in. Admins manage this panel and plugins; the owner role can only be handed over."
      />
      <CardBody flush>
        {accounts.isPending ? (
          <SkeletonRows count={3} />
        ) : accounts.isError ? (
          <ErrorState compact error={accounts.error} onRetry={() => void accounts.refetch()} />
        ) : (
          <ul className={styles.list}>
            {accounts.data.map((a) => (
              <li key={a.id} className={`${styles.item} ${styles.itemCenter}`}>
                <Avatar src={a.avatarUrl} name={a.name} size={32} />
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    {a.name}
                    {a.id === myId && <Badge variant="outline">You</Badge>}
                  </div>
                  <div className={styles.rowMeta}>
                    {a.discordId ? 'Discord' : 'Local account'}
                    {a.lastSeenAt ? ` · seen ${relativeTime(a.lastSeenAt)}` : ' · never seen'}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  {a.instanceRole === 'owner' ? (
                    <Badge tone="accent" icon={<Crown />}>
                      Owner
                    </Badge>
                  ) : (
                    <Select
                      size="sm"
                      aria-label={`Role of ${a.name}`}
                      value={a.instanceRole}
                      options={ROLE_OPTIONS}
                      disabled={setRole.isPending || a.id === myId}
                      onValueChange={(role) =>
                        setRole.mutate({ accountId: a.id, role: role as UpdateInstanceRoleRequest['role'] })
                      }
                    />
                  )}
                  {isOwner && a.instanceRole !== 'owner' ? (
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton size="sm" label={`More for ${a.name}`} icon={<MoreHorizontal />} />
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Crown />} onSelect={() => setHandover(a)}>
                          Make owner…
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  ) : (
                    isOwner && <span style={{ width: 26 }} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={handover !== null}
        onOpenChange={(open) => !open && setHandover(null)}
        title={`Make ${handover?.name ?? ''} the owner?`}
        description="You become an admin. Only the new owner can hand it back."
        confirmLabel="Hand over ownership"
        tone="danger"
        onConfirm={() => handover && transfer.mutateAsync(handover.id)}
      />
    </Card>
  );
}

// ---- Plugins ----------------------------------------------------------------------------------

function PluginsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['admin-plugins'];
  const plugins = useQuery({ queryKey: key, queryFn: () => api<PluginDto[]>(routes.plugins.list.path) });
  const [source, setSource] = useState('');
  const [removing, setRemoving] = useState<PluginDto | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['web-plugins'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-catalog'] }),
    ]);
  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: errorText(error, 'Try again.'), tone: 'danger' });
  const install = useMutation({
    mutationFn: (src: string) =>
      api<PluginDto>(routes.plugins.install.path, { method: 'POST', json: { source: src } }),
    onSuccess: (p) => {
      setSource('');
      void refresh();
      toast({ title: `${p.name} installed`, description: 'Review it, then switch it on.', tone: 'success' });
    },
    onError: failed('Could not install'),
  });
  const toggle = useMutation({
    mutationFn: (p: PluginDto) =>
      api<PluginDto>(buildPath(routes.plugins.setEnabled.path, { pluginId: p.id }), {
        method: 'PUT',
        json: { enabled: !p.enabled },
      }),
    onSuccess: refresh,
    onError: failed('Could not switch the plugin'),
  });
  const uninstall = useMutation({
    mutationFn: (id: string) =>
      api<void>(buildPath(routes.plugins.uninstall.path, { pluginId: id }), { method: 'DELETE' }),
    onSuccess: refresh,
    onError: failed('Could not uninstall'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (source.trim()) install.mutate(source.trim());
  };

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Installed plugins"
          description="New plugins start switched off. Switching applies at once; a new version reloads the plugin."
        />
        <CardBody flush>
          {plugins.isPending ? (
            <SkeletonRows count={2} avatar={false} />
          ) : plugins.isError ? (
            <ErrorState compact error={plugins.error} onRetry={() => void plugins.refetch()} />
          ) : plugins.data.length === 0 ? (
            <EmptyState
              compact
              icon={<Puzzle />}
              title="No plugins yet"
              description="Install one shipped with this server below, or any package from npm."
            />
          ) : (
            <ul className={styles.list}>
              {plugins.data.map((p) => (
                <li key={p.id} className={styles.item}>
                  <span className={styles.subjectIcon} aria-hidden>
                    <Puzzle />
                  </span>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {p.name}
                      <span className={`${styles.version} mono`}>{p.version}</span>
                      {p.enabled ? (
                        <Badge tone="success" dot>
                          On
                        </Badge>
                      ) : (
                        <Badge>Off</Badge>
                      )}
                    </div>
                    {p.description && <div className={styles.rowMeta}>{p.description}</div>}
                    <div className={styles.chips} aria-label="Permissions">
                      {p.ports.map((port) => (
                        <Badge key={port} variant="outline" tone={port === 'db' ? 'danger' : 'neutral'}>
                          {port}
                        </Badge>
                      ))}
                      {p.events.length > 0 && (
                        <Badge variant="outline" title={p.events.join(', ')}>
                          {p.events.length} event{p.events.length === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    {(p.ports.includes('db') || p.error) && (
                      <div className={styles.rowNotes}>
                        {p.ports.includes('db') && (
                          <Callout tone="warning" title="Full database access">
                            This plugin can read and change every table, including sessions and tokens. Switch
                            it on only if you trust its author.
                          </Callout>
                        )}
                        {p.error && (
                          <Callout tone="danger" title="Switched off after errors">
                            {p.error}
                          </Callout>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={styles.rowActions}>
                    <Switch
                      checked={p.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={() => toggle.mutate(p)}
                      label={<span className="sr-only">Enable {p.name}</span>}
                    />
                    <IconButton
                      size="sm"
                      variant="danger-ghost"
                      label={`Uninstall ${p.name}`}
                      icon={<Trash2 />}
                      onClick={() => setRemoving(p)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Catalogue kind="plugin" onInstalled={() => void refresh()} />

      <Card>
        <form onSubmit={submit} aria-label="Install plugin">
          <CardHeader
            title="Install from npm"
            description="A package name with an optional exact version or tag."
          />
          <CardBody>
            <div className={styles.inline}>
              <Field label="Package">
                <Input
                  mono
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="darkbeacon-plugin-example@1.0.0"
                />
              </Field>
              <Button type="submit" icon={<Plus />} loading={install.isPending} disabled={!source.trim()}>
                Install
              </Button>
            </div>
          </CardBody>
        </form>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Uninstall ${removing?.name ?? ''}?`}
        description="Its files are removed. Tables it created and its settings stay, so installing it again picks up where it left off."
        confirmLabel="Uninstall"
        tone="danger"
        onConfirm={() => removing && uninstall.mutateAsync(removing.id)}
      />
    </Stack>
  );
}

/** Packages shipped with the server, installable with one click. */
function Catalogue({ kind, onInstalled }: { kind: CatalogEntryDto['kind']; onInstalled: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const catalog = useQuery({
    queryKey: ['admin-catalog'],
    queryFn: () => api<CatalogEntryDto[]>(routes.plugins.catalog.path),
  });
  const install = useMutation({
    mutationFn: (source: string) =>
      api<unknown>(kind === 'plugin' ? routes.plugins.install.path : routes.themes.install.path, {
        method: 'POST',
        json: { source },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-catalog'] });
      onInstalled();
    },
    onError: (error) =>
      toast({ title: 'Could not install', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const entries = catalog.data?.filter((e) => e.kind === kind) ?? [];
  if (catalog.isPending || entries.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Shipped with this server"
        description={
          kind === 'plugin'
            ? 'First-party plugins, ready to install.'
            : 'First-party themes, ready to install.'
        }
      />
      <CardBody flush>
        <ul className={styles.list}>
          {entries.map((e) => {
            const current = e.installedVersion === e.version;
            return (
              <li key={e.source} className={styles.item}>
                <span className={styles.subjectIcon} aria-hidden>
                  {kind === 'plugin' ? <Package /> : <Palette />}
                </span>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    {e.name}
                    <span className={`${styles.version} mono`}>{e.version}</span>
                  </div>
                  {e.description && <div className={styles.rowMeta}>{e.description}</div>}
                </div>
                <div className={styles.rowActions}>
                  {current ? (
                    <Badge tone="success">Installed</Badge>
                  ) : (
                    <Button
                      size="sm"
                      loading={install.isPending && install.variables === e.source}
                      disabled={install.isPending}
                      onClick={() => install.mutate(e.source)}
                    >
                      {e.installedVersion === null ? 'Install' : `Update from ${e.installedVersion}`}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ---- Themes -----------------------------------------------------------------------------------

function ThemesTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { refresh: refreshThemes } = useTheme();
  const [removing, setRemoving] = useState<ThemeDto | null>(null);
  const themes = useQuery({
    queryKey: ['admin-themes'],
    queryFn: () => api<ThemesDto>(routes.themes.list.path),
  });
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-themes'] });
    refreshThemes();
  };
  const setDefault = useMutation({
    mutationFn: (themeId: string) =>
      api<ThemesDto>(routes.themes.setDefault.path, { method: 'PUT', json: { themeId } }),
    onSuccess: () => {
      changed();
      toast({ title: 'Default theme saved', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const uninstall = useMutation({
    mutationFn: (t: ThemeDto) =>
      api<void>(buildPath(routes.themes.uninstall.path, { themeId: t.id }), { method: 'DELETE' }),
    onSuccess: changed,
    onError: (error) =>
      toast({ title: 'Could not uninstall', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const options = [
    { value: 'system', label: 'System (follows each computer)' },
    ...(themes.data?.themes.map((t) => ({ value: t.id, label: t.name })) ?? []),
  ];
  const installed = themes.data?.themes.filter((t) => !t.builtIn) ?? [];

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Default theme"
          description="For everyone who has not picked a theme. System follows each computer's light or dark mode."
        />
        <CardBody>
          <Field label="Theme">
            <Select
              value={themes.data?.defaultThemeId}
              options={options}
              disabled={!themes.data || setDefault.isPending}
              onValueChange={(id) => setDefault.mutate(id)}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Installed themes"
          description="Theme packages change colours and sizes, never features."
        />
        <CardBody flush>
          {themes.isPending ? (
            <SkeletonRows count={2} avatar={false} />
          ) : installed.length === 0 ? (
            <EmptyState
              compact
              icon={<Palette />}
              title="Only the built-in themes"
              description="Light, Dark and High contrast are always there. Install more below."
            />
          ) : (
            <ul className={styles.list}>
              {installed.map((t) => (
                <li key={t.id} className={`${styles.item} ${styles.itemCenter}`}>
                  <span
                    className={styles.subjectIcon}
                    style={{ background: t.tokens['color-bg'], color: t.tokens['color-accent'] }}
                    aria-hidden
                  >
                    <Palette />
                  </span>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {t.name}
                      {t.version && <span className={`${styles.version} mono`}>{t.version}</span>}
                    </div>
                    <div className={styles.rowMeta}>{t.colorScheme === 'dark' ? 'Dark' : 'Light'}</div>
                  </div>
                  <IconButton
                    size="sm"
                    variant="danger-ghost"
                    label={`Uninstall ${t.name}`}
                    icon={<Trash2 />}
                    onClick={() => setRemoving(t)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Catalogue kind="theme" onInstalled={changed} />

      <Card>
        <CardHeader title="Your theme" description="Just for you, saved to your account." />
        <CardBody>
          <ThemePicker />
        </CardBody>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Uninstall ${removing?.name ?? ''}?`}
        description="People who picked it fall back to the default theme."
        confirmLabel="Uninstall"
        tone="danger"
        onConfirm={() => removing && uninstall.mutateAsync(removing)}
      />
    </Stack>
  );
}
