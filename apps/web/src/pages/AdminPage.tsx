import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
} from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useMe } from '../lib/session';
import { PluginSlot } from '../plugins/PluginSlot';
import { ThemePicker } from '../theme/ThemePicker';
import { useTheme } from '../theme/ThemeProvider';
import styles from './pages.module.css';

const TABS = [
  { id: 'instance', title: 'Instance' },
  { id: 'roles', title: 'Roles' },
  { id: 'plugins', title: 'Plugins' },
  { id: 'themes', title: 'Themes' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function AdminPage() {
  const [tab, setTab] = useState<TabId>('instance');
  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <h1>Admin</h1>
      </div>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>
      {tab === 'instance' && <InstanceTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'plugins' && <PluginsTab />}
      {tab === 'themes' && <ThemesTab />}
    </section>
  );
}

function InstanceTab() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string; version: string; database: string }>(routes.health.path),
  });
  return (
    <>
      <div className={styles.section}>
        <h2>Instance</h2>
        {health.data && (
          <ul className={styles.rows}>
            <li className={styles.row}>
              <span className={styles.grow}>Version</span>
              <code>{health.data.version}</code>
            </li>
            <li className={styles.row}>
              <span className={styles.grow}>Database</span>
              <code>{health.data.database}</code>
            </li>
          </ul>
        )}
      </div>
      <DiscordAdminSettings />
      <WebhookSettings />
      <PluginSlot slot="settingsPage" props={{ mapId: null }} />
    </>
  );
}

/** Ids as typed in a text field: comma or space separated. */
const idList = (text: string) => text.split(/[\s,]+/).filter(Boolean);

function DiscordAdminSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
  const [draft, setDraft] = useState<{ guild: string; roles: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: { adminGuildId: string | null; adminRoleIds: string[] }) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-settings'], data);
      setDraft(null);
    },
  });
  if (!settings.data) return null;
  const value = draft ?? {
    guild: settings.data.adminGuildId ?? '',
    roles: settings.data.adminRoleIds.join(', '),
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ adminGuildId: value.guild.trim() || null, adminRoleIds: idList(value.roles) });
  };
  return (
    <form className={styles.section} onSubmit={submit} aria-label="Discord admin roles">
      <h2>Admins from Discord</h2>
      <p className="muted">
        Members holding one of these roles on this Discord server become instance admins at their next login.
      </p>
      <div className={styles.inline}>
        <label className={`field ${styles.field}`}>
          <span>Discord server id</span>
          <input
            className="input"
            inputMode="numeric"
            value={value.guild}
            onChange={(e) => setDraft({ ...value, guild: e.target.value })}
          />
        </label>
        <label className={`field ${styles.field}`}>
          <span>Role ids</span>
          <input
            className="input"
            value={value.roles}
            onChange={(e) => setDraft({ ...value, roles: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={save.isPending || !draft}>
          Save
        </button>
      </div>
      {save.error && <p className="error">{errorText(save.error, 'Could not save the settings.')}</p>}
    </form>
  );
}

function WebhookSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
  const save = useMutation({
    mutationFn: (webhooksToPrivateNetworks: boolean) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, {
        method: 'PATCH',
        json: { webhooksToPrivateNetworks },
      }),
    onSuccess: (data) => queryClient.setQueryData(['admin-settings'], data),
  });
  if (!settings.data) return null;
  return (
    <div className={styles.section}>
      <h2>Webhooks</h2>
      <label className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.data.webhooksToPrivateNetworks}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        Allow webhooks to private networks
      </label>
      <p className="muted">
        Off by default: webhooks cannot reach this server, its local network or cloud metadata addresses. Turn
        it on only if every map admin may send requests into your network.
      </p>
      {save.error && <p className="error">{errorText(save.error, 'Could not save the settings.')}</p>}
    </div>
  );
}

/** Packages shipped with the server, installable with one click. */
function Catalogue({ kind, onInstalled }: { kind: CatalogEntryDto['kind']; onInstalled: () => void }) {
  const queryClient = useQueryClient();
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
  });
  const entries = catalog.data?.filter((e) => e.kind === kind) ?? [];
  if (entries.length === 0) return null;
  return (
    <>
      <h3>Shipped with this server</h3>
      <ul className={styles.rows}>
        {entries.map((e) => (
          <li key={e.source} className={styles.row}>
            <span className={styles.grow}>
              <strong>{e.name}</strong> <span className="muted">{e.version}</span>
              {e.description && <div className="muted">{e.description}</div>}
            </span>
            <button
              type="button"
              className="btn btn-small"
              disabled={install.isPending || e.installedVersion === e.version}
              onClick={() => install.mutate(e.source)}
            >
              {e.installedVersion === null
                ? 'Install'
                : e.installedVersion === e.version
                  ? 'Installed'
                  : 'Update'}
            </button>
          </li>
        ))}
      </ul>
      {install.error && <p className="error">{errorText(install.error, 'Could not install.')}</p>}
    </>
  );
}

function RolesTab() {
  const me = useMe();
  const queryClient = useQueryClient();
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
  });
  const transfer = useMutation({
    mutationFn: (accountId: string) =>
      api<void>(routes.admin.transferOwnership.path, { method: 'POST', json: { accountId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      void queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
  const isOwner = me.data?.account.instanceRole === 'owner';
  const error = setRole.error ?? transfer.error ?? accounts.error;

  return (
    <div className={styles.section}>
      <h2>Roles</h2>
      <p className="muted">Admins manage this panel and plugins. The owner role can only be handed over.</p>
      {accounts.isPending && <p className="muted">Loading…</p>}
      <ul className={styles.rows}>
        {accounts.data?.map((a) => (
          <li key={a.id} className={styles.row}>
            {a.avatarUrl ? (
              <img className={styles.avatar} src={a.avatarUrl} alt="" />
            ) : (
              <span className={styles.avatar} />
            )}
            <span className={styles.grow}>
              <strong>{a.name}</strong>
              {a.lastSeenAt && (
                <div className="muted">Last seen {new Date(a.lastSeenAt).toLocaleString()}</div>
              )}
            </span>
            {a.instanceRole === 'owner' ? (
              <span className={styles.pill}>owner</span>
            ) : (
              <select
                className="input"
                aria-label={`Role of ${a.name}`}
                value={a.instanceRole}
                disabled={setRole.isPending || a.id === me.data?.account.id}
                onChange={(e) =>
                  setRole.mutate({
                    accountId: a.id,
                    role: e.target.value as UpdateInstanceRoleRequest['role'],
                  })
                }
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            )}
            {isOwner && a.instanceRole !== 'owner' && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  if (window.confirm(`Make ${a.name} the owner? You become an admin.`)) transfer.mutate(a.id);
                }}
              >
                Make owner
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{errorText(error, 'Something went wrong.')}</p>}
    </div>
  );
}

function PluginsTab() {
  const queryClient = useQueryClient();
  const key = ['admin-plugins'];
  const plugins = useQuery({ queryKey: key, queryFn: () => api<PluginDto[]>(routes.plugins.list.path) });
  const [source, setSource] = useState('');
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['web-plugins'] }),
    ]);
  const install = useMutation({
    mutationFn: (src: string) =>
      api<PluginDto>(routes.plugins.install.path, { method: 'POST', json: { source: src } }),
    onSuccess: () => {
      setSource('');
      void refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (p: PluginDto) =>
      api<PluginDto>(buildPath(routes.plugins.setEnabled.path, { pluginId: p.id }), {
        method: 'PUT',
        json: { enabled: !p.enabled },
      }),
    onSuccess: refresh,
  });
  const uninstall = useMutation({
    mutationFn: (id: string) =>
      api<void>(buildPath(routes.plugins.uninstall.path, { pluginId: id }), { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const error = install.error ?? toggle.error ?? uninstall.error ?? plugins.error;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (source.trim()) install.mutate(source.trim());
  };

  return (
    <div className={styles.section}>
      <h2>Plugins</h2>
      <p className="muted">
        Installing a new version restarts the server. Enabling and disabling apply at once.
      </p>
      {plugins.data?.length === 0 && <p className="muted">No plugins installed.</p>}
      <ul className={styles.rows}>
        {plugins.data?.map((p) => (
          <li key={p.id} className={styles.row}>
            <span className={styles.grow}>
              <strong>{p.name}</strong> <span className="muted">{p.version}</span>
              <div className="muted">
                Ports: {p.ports.join(', ') || 'none'}. Events: {p.events.join(', ') || 'none'}.
              </div>
              {p.ports.includes('db') && (
                <div className="error">
                  Full database access: this plugin can read and change every table, including sessions and
                  tokens. Enable it only if you trust its author.
                </div>
              )}
              {p.error && <div className="error">{p.error}</div>}
            </span>
            <label className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={p.enabled}
                disabled={toggle.isPending}
                onChange={() => toggle.mutate(p)}
              />
              Enabled
            </label>
            <button
              type="button"
              className="btn btn-small btn-danger"
              disabled={uninstall.isPending}
              onClick={() => {
                if (window.confirm(`Uninstall ${p.name}?`)) uninstall.mutate(p.id);
              }}
            >
              Uninstall
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.inline}
        onSubmit={submit}
        style={{ marginTop: 'var(--ww-space-3)' }}
        aria-label="Install plugin"
      >
        <label className={`field ${styles.field}`}>
          <span>npm package or .tgz URL</span>
          <input
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="wormwright-plugin-…"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={install.isPending || !source.trim()}>
          Install
        </button>
      </form>
      <Catalogue kind="plugin" onInstalled={() => void refresh()} />
      {error && <p className="error">{errorText(error, 'Something went wrong.')}</p>}
    </div>
  );
}

function ThemesTab() {
  const queryClient = useQueryClient();
  const { refresh: refreshThemes } = useTheme();
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
    onSuccess: changed,
  });
  const uninstall = useMutation({
    mutationFn: (t: ThemeDto) =>
      api<void>(buildPath(routes.themes.uninstall.path, { themeId: t.id }), { method: 'DELETE' }),
    onSuccess: changed,
  });
  const error = setDefault.error ?? uninstall.error;
  return (
    <div className={styles.section}>
      <h2>Themes</h2>
      {themes.data && (
        <label className="field">
          <span>Default for everyone who has not picked a theme</span>
          <select
            className="input"
            value={themes.data.defaultThemeId}
            disabled={setDefault.isPending}
            onChange={(e) => setDefault.mutate(e.target.value)}
          >
            {themes.data.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ul className={styles.rows}>
        {themes.data?.themes
          .filter((t) => !t.builtIn)
          .map((t) => (
            <li key={t.id} className={styles.row}>
              <span className={styles.grow}>
                <strong>{t.name}</strong> <span className="muted">{t.version}</span>
              </span>
              <button
                type="button"
                className="btn btn-small btn-danger"
                disabled={uninstall.isPending}
                onClick={() => {
                  if (window.confirm(`Uninstall ${t.name}?`)) uninstall.mutate(t);
                }}
              >
                Uninstall
              </button>
            </li>
          ))}
      </ul>
      <Catalogue kind="theme" onInstalled={changed} />
      {error && <p className="error">{errorText(error, 'Something went wrong.')}</p>}
      <h3>Your theme</h3>
      <ThemePicker />
    </div>
  );
}
