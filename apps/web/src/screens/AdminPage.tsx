'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Crown,
  MessageSquare,
  MoreHorizontal,
  Package,
  Palette,
  Plus,
  Puzzle,
  ScrollText,
  Server,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  buildPath,
  routes,
  type AdminAccountDto,
  type CatalogEntryDto,
  type DiscordBotDto,
  type HealthDto,
  type InstanceSettingsDto,
  type PluginDto,
  type ThemeDto,
  type ThemesDto,
  type UpdateInstanceRoleRequest,
  type UpdateInstanceSettingsRequest,
} from '@darkbeacon/shared';
import { discordKeys, GuildSelect, RoleSelect, useDiscordRoles } from '../components/pickers';
import { accountImageOf } from '../lib/account';
import { api, ApiError } from '../lib/api';
import { useInstance, useMaps } from '../lib/maps';
import { instanceKey } from '../lib/session-keys';
import { meKey, providersKey, useMe, useProviders } from '../lib/session';
import { relativeTime } from '../lib/time';
import { useTabParam } from '../lib/useTabParam';
import { usePageView } from '../lib/useTelemetry';
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
  ChoiceGroup,
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
import { AuditTab } from './AuditTab';
import { TelemetryCard } from './TelemetryCard';
import styles from './settings.module.css';

const TABS = [
  { id: 'instance', title: 'Instance', icon: <Server /> },
  { id: 'people', title: 'People', icon: <Users /> },
  { id: 'plugins', title: 'Plugins', icon: <Puzzle /> },
  { id: 'themes', title: 'Themes', icon: <Palette /> },
  { id: 'audit', title: 'Audit', icon: <ScrollText /> },
] as const;
type TabId = (typeof TABS)[number]['id'];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const TITLE = 'Admin';
const DESCRIPTION = 'Settings for this instance, the people on it, plugins, themes and what changed.';

/** Query keys of the data the server renders the first tab with. */
export const adminKeys = {
  settings: ['admin-settings'],
  health: ['health'],
  bot: ['admin-discord-bot'],
} as const;

/** The admin page as it looks while its data streams in. */
export function AdminPageSkeleton() {
  return (
    <Page width={880} aria-busy="true">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Skeleton width="100%" height={36} style={{ marginBottom: 24 }} />
      <Skeleton width="100%" height={220} radius={10} />
    </Page>
  );
}

export function AdminPage() {
  useBreadcrumbs([{ label: 'Admin' }]);
  const [tab, setTab] = useTabParam<TabId>(
    TABS.map((t) => t.id),
    'instance',
  );
  usePageView('admin', tab);
  return (
    <Page width={880}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
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
        <TabsContent value="audit">
          <AuditTab settingsKey={adminKeys.settings} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

// ---- Instance ---------------------------------------------------------------------------------

function useInstanceSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
}

function useSaveSettings(success?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: UpdateInstanceSettingsRequest) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: (data) => {
      queryClient.setQueryData(adminKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: providersKey });
      void queryClient.invalidateQueries({ queryKey: instanceKey });
      if (success) toast({ title: success, tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
}

function InstanceTab() {
  const providers = useProviders();
  const health = useQuery({
    queryKey: adminKeys.health,
    queryFn: () => api<HealthDto>(routes.health.path),
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
      <SignInSettings />
      <DefaultMapSettings />
      <DiscordBotSettings />
      {providers.data?.loginMethod === 'discord' && <DiscordAdminSettings />}
      <WebhookSettings />
      <TelemetryCard />
      <PluginSlot slot="settingsPage" props={{ mapId: null }} />
    </Stack>
  );
}

function SignInSettings() {
  const providers = useProviders();
  const save = useSaveSettings('Sign-in saved');
  const discord = providers.data?.discord ?? false;
  return (
    <Card>
      <CardHeader
        title="How people sign in"
        description="One way in for everyone. Accounts made either way keep working when you switch."
      />
      <CardBody>
        <ChoiceGroup
          aria-label="Sign-in method"
          value={providers.data?.loginMethod}
          disabled={!providers.data || save.isPending}
          onValueChange={(loginMethod) => save.mutate({ loginMethod: loginMethod as 'discord' | 'eve' })}
          options={[
            {
              value: 'eve',
              label: 'EVE Online',
              icon: <UserRound />,
              description:
                'Sign in with a character. A new character gets its own account; characters added while signed in join it.',
            },
            {
              value: 'discord',
              label: 'Discord',
              icon: <MessageSquare />,
              disabled: !discord,
              description: discord
                ? 'Sign in with Discord, then link EVE characters. Discord roles can grant map access and admin.'
                : 'Not configured on this server (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET).',
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

const NO_MAP = '__none__';

function DefaultMapSettings() {
  const settings = useInstanceSettings();
  const maps = useMaps();
  const save = useSaveSettings('Default map saved');
  return (
    <Card>
      <CardHeader
        title="Default map"
        description="Opens first for everyone who can see it and has not starred a map of their own."
      />
      <CardBody>
        <Field label="Map">
          <Select
            value={settings.data && maps.data ? (settings.data.defaultMapId ?? NO_MAP) : undefined}
            disabled={!settings.data || !maps.data || save.isPending}
            placeholder="Loading maps…"
            options={[
              { value: NO_MAP, label: 'None: the map each person used last' },
              ...(maps.data ?? []).map((m) => ({ value: m.id, label: m.name })),
            ]}
            onValueChange={(id) => save.mutate({ defaultMapId: id === NO_MAP ? null : id })}
          />
        </Field>
      </CardBody>
    </Card>
  );
}

function DiscordBotSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [removing, setRemoving] = useState(false);
  const bot = useQuery({
    queryKey: adminKeys.bot,
    queryFn: () => api<DiscordBotDto>(routes.admin.discordBot.path),
  });
  const changed = (data: DiscordBotDto | null) => {
    if (data) queryClient.setQueryData(adminKeys.bot, data);
    else void queryClient.invalidateQueries({ queryKey: adminKeys.bot });
    void queryClient.invalidateQueries({ queryKey: instanceKey });
    void queryClient.invalidateQueries({ queryKey: discordKeys.guilds });
  };
  const connect = useMutation({
    mutationFn: () =>
      api<DiscordBotDto>(routes.admin.setDiscordBot.path, { method: 'PUT', json: { token: token.trim() } }),
    onSuccess: (data) => {
      setToken('');
      changed(data);
      toast({ title: `${data.name ?? 'The bot'} is connected`, tone: 'success' });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>(routes.admin.removeDiscordBot.path, { method: 'DELETE' }),
    onSuccess: () => changed(null),
    onError: (error) =>
      toast({ title: 'Could not disconnect', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim()) connect.mutate();
  };

  return (
    <Card>
      <CardHeader
        title="Discord bot"
        description="Optional. With a bot, servers, roles and channels are picked from lists, and map notifications can post to a channel without a webhook."
      />
      {bot.isPending ? (
        <CardBody>
          <Skeleton height={36} />
        </CardBody>
      ) : bot.data?.configured ? (
        <>
          <CardBody>
            <div className={styles.botRow}>
              <Avatar src={bot.data.avatarUrl} name={bot.data.name ?? 'Bot'} size={36} />
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>
                  {bot.data.name}
                  {bot.data.error ? (
                    <Badge tone="danger" dot>
                      Not working
                    </Badge>
                  ) : (
                    <Badge tone="success" dot>
                      Connected
                    </Badge>
                  )}
                </div>
                <div className={styles.rowMeta}>
                  {bot.data.error ??
                    'Add it to every Discord server whose roles or channels you want to use.'}
                </div>
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button onClick={() => setRemoving(true)}>Disconnect</Button>
            {bot.data.inviteUrl && (
              <Button asChild variant="primary" trailingIcon={<ArrowUpRight />}>
                <a href={bot.data.inviteUrl} target="_blank" rel="noreferrer">
                  Add to a server
                </a>
              </Button>
            )}
          </CardFooter>
        </>
      ) : (
        <form onSubmit={submit} aria-label="Connect a Discord bot">
          <CardBody>
            <Field
              label="Bot token"
              hint="Discord developer portal, your application, Bot, Reset token. It is stored encrypted and never shown again."
              error={connect.error ? errorText(connect.error, 'Could not connect the bot.') : undefined}
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder="Paste the token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          </CardBody>
          <CardFooter>
            <Button type="submit" variant="primary" loading={connect.isPending} disabled={!token.trim()}>
              Connect bot
            </Button>
          </CardFooter>
        </form>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Disconnect the bot?"
        description="Map notifications posting through it stop, and Discord lists are no longer available. Webhooks keep working."
        confirmLabel="Disconnect bot"
        tone="danger"
        onConfirm={() => remove.mutateAsync()}
      />
    </Card>
  );
}

function DiscordAdminSettings() {
  const settings = useInstanceSettings();
  const instance = useInstance();
  const save = useSaveSettings('Discord admin roles saved');
  const [draft, setDraft] = useState<{ guild: string | null; roles: string[] } | null>(null);
  const value = draft ?? {
    guild: settings.data?.adminGuildId ?? null,
    roles: settings.data?.adminRoleIds ?? [],
  };
  const roles = useDiscordRoles(value.guild);
  const bot = instance.data?.discordBot ?? false;
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name;

  return (
    <Card>
      <CardHeader
        title="Admins from Discord"
        description="Members holding one of these roles on this Discord server become instance admins when they next sign in. Roles only ever add admin, never remove it."
      />
      <CardBody>
        {!bot ? (
          <Callout tone="neutral" title="Connect the Discord bot first">
            The server and its roles are picked from the bot's lists, so add the bot above.
          </Callout>
        ) : (
          <div className={styles.grid}>
            <Field label="Discord server">
              <GuildSelect
                value={value.guild}
                disabled={!settings.data}
                onChange={(guild) => setDraft({ guild, roles: guild === value.guild ? value.roles : [] })}
              />
            </Field>
            <Field label="Add a role">
              <RoleSelect
                guildId={value.guild}
                value={null}
                onChange={(roleId) =>
                  setDraft({
                    ...value,
                    roles: value.roles.includes(roleId) ? value.roles : [...value.roles, roleId],
                  })
                }
              />
            </Field>
          </div>
        )}
        {value.roles.length > 0 && (
          <div className={styles.chips} aria-label="Admin roles">
            {value.roles.map((id) => (
              <Badge key={id} variant="outline">
                @{roleName(id) ?? (roles.isPending ? '…' : 'Deleted role')}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${roleName(id) ?? 'role'}`}
                  onClick={() => setDraft({ ...value, roles: value.roles.filter((r) => r !== id) })}
                >
                  <X />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardBody>
      <CardFooter>
        {draft && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        )}
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!draft}
          onClick={() =>
            save.mutate(
              { adminGuildId: value.guild, adminRoleIds: value.guild ? value.roles : [] },
              { onSuccess: () => setDraft(null) },
            )
          }
        >
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function WebhookSettings() {
  const settings = useInstanceSettings();
  const save = useSaveSettings();
  return (
    <Card>
      <CardHeader title="Webhooks" description="Where map webhooks may send events." />
      <CardBody>
        <Switch
          checked={settings.data?.webhooksToPrivateNetworks ?? false}
          disabled={!settings.data || save.isPending}
          onCheckedChange={(on) => save.mutate({ webhooksToPrivateNetworks: on })}
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
  const eveMode = useProviders().data?.loginMethod === 'eve';
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
                <Avatar src={accountImageOf(a)} name={a.name} size={32} />
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    {a.name}
                    {a.id === myId && <Badge variant="outline">You</Badge>}
                  </div>
                  <div className={styles.rowMeta}>
                    {a.discordId ? 'Discord' : eveMode ? 'EVE Online' : 'Local account'}
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
  // First-party plugins at the version shipped here: their database use is the server's own.
  const catalog = useQuery({
    queryKey: ['admin-catalog'],
    queryFn: () => api<CatalogEntryDto[]>(routes.plugins.catalog.path),
  });
  const shipped = new Set(
    (catalog.data ?? [])
      .filter((e) => e.kind === 'plugin' && e.installedVersion === e.version)
      .map((e) => e.id),
  );
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
          description="Plugins you install start switched off; the ones shipped with this server start on. Switching applies at once; a new version reloads the plugin."
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
                        <Badge
                          key={port}
                          variant="outline"
                          tone={port === 'db' && !shipped.has(p.id) ? 'danger' : 'neutral'}
                        >
                          {port}
                        </Badge>
                      ))}
                      {p.events.length > 0 && (
                        <Badge variant="outline" title={p.events.join(', ')}>
                          {p.events.length} event{p.events.length === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    {((p.ports.includes('db') && !shipped.has(p.id)) || p.error) && (
                      <div className={styles.rowNotes}>
                        {p.ports.includes('db') && !shipped.has(p.id) && (
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
