import { Link, Outlet } from 'react-router';
import { useConnectionStatus } from '../lib/RealtimeProvider';
import { useTheme } from '../theme/ThemeProvider';
import styles from './Layout.module.css';

export function Layout() {
  const { theme, themes, setTheme } = useTheme();
  const status = useConnectionStatus();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          Wormwright
        </Link>
        <span className={styles.status} data-status={status} title={`Realtime: ${status}`} />
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
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
