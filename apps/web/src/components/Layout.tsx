import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useConnectionStatus, useRealtime } from '../lib/RealtimeProvider';
import { isInstanceAdmin, useMe } from '../lib/session';
import { PluginsProvider } from '../plugins/PluginSlot';
import { useTheme } from '../theme/ThemeProvider';
import styles from './Layout.module.css';

const STATUS_TEXT = { open: 'Live', connecting: 'Connecting…', closed: 'Offline' } as const;

export function Layout() {
  const { theme, themes, setTheme } = useTheme();
  const status = useConnectionStatus();
  const me = useMe();
  const account = me.data?.account;
  const realtime = useRealtime();
  const accountId = me.data === undefined ? undefined : (account?.id ?? null);
  const lastAccount = useRef(accountId);

  // The socket authenticates with the session cookie at connect time; reconnect when it changes.
  useEffect(() => {
    if (accountId === undefined || lastAccount.current === accountId) return;
    const wasKnown = lastAccount.current !== undefined;
    lastAccount.current = accountId;
    if (wasKnown) realtime.reconnect();
  }, [accountId, realtime]);

  return (
    <PluginsProvider enabled={!!account}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link to="/" className={styles.brand}>
            Wormwright
          </Link>
          {account && (
            <nav className={styles.nav}>
              <NavLink to="/" end className={styles.link}>
                Maps
              </NavLink>
              {isInstanceAdmin(me.data) && (
                <NavLink to="/admin" className={styles.link}>
                  Admin
                </NavLink>
              )}
            </nav>
          )}
          <span className={styles.spacer} />
          <span
            className={styles.status}
            data-status={status}
            role="img"
            aria-label={`Realtime: ${STATUS_TEXT[status]}`}
            title={`Realtime: ${STATUS_TEXT[status]}`}
          />
          <select
            className={styles.select}
            aria-label="Theme"
            value={theme.id}
            onChange={(e) => setTheme(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {account ? (
            <NavLink to="/account" className={styles.account} title="Account">
              {account.avatarUrl ? (
                <img src={account.avatarUrl} alt="" className={styles.avatar} />
              ) : (
                <span className={styles.avatar} aria-hidden>
                  {account.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={styles.accountName}>{account.name}</span>
            </NavLink>
          ) : (
            <Link to="/login" className="btn btn-small">
              Sign in
            </Link>
          )}
        </header>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </PluginsProvider>
  );
}
