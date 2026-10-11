import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  type AdminAccountDto,
  type PluginDto,
  type UpdateInstanceRoleRequest,
} from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useMe } from '../lib/session';
import { PluginSlot } from '../plugins/PluginSlot';
import { ThemePicker } from '../theme/ThemePicker';
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
        <p className="muted">
          Settings that are not needed before the first login will be edited here: the admin Discord role,
          event retention and the default theme.
        </p>
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
      <PluginSlot slot="settingsPage" props={{ mapId: null }} />
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
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
      {error && <p className="error">{errorText(error, 'Something went wrong.')}</p>}
    </div>
  );
}

function ThemesTab() {
  return (
    <div className={styles.section}>
      <h2>Themes</h2>
      <p className="muted">
        Built-in themes are below. Installing theme packages and choosing the default for this instance and
        per map come later; for now each person picks a theme for their browser.
      </p>
      <ThemePicker />
    </div>
  );
}
