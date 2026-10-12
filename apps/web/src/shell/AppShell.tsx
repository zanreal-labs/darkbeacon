import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight, Map as MapIcon, Shield, UserRound } from 'lucide-react';
import type { MeDto } from '@wormwright/shared';
import { useConnectionStatus, useRealtime } from '../lib/RealtimeProvider';
import { isInstanceAdmin, useDemoMode } from '../lib/session';
import { PluginsProvider } from '../plugins/PluginSlot';
import { useTheme } from '../theme/ThemeProvider';
import { Badge, StatusDot, Tooltip } from '../ui';
import { AccountMenu } from './AccountMenu';
import { BreadcrumbProvider, useBreadcrumbItems, type Crumb } from './breadcrumbs';
import { LogoMark } from './Logo';
import { ThemeMenu } from './ThemeMenu';
import styles from './AppShell.module.css';

const STATUS = {
  open: { label: 'Live', color: 'var(--ww-color-success)', hint: 'Changes from others appear instantly.' },
  connecting: { label: 'Connecting', color: 'var(--ww-color-warning)', hint: 'Reconnecting to the server…' },
  closed: {
    label: 'Offline',
    color: 'var(--ww-color-danger)',
    hint: 'Not connected. Retrying in the background.',
  },
} as const;

function ConnectionIndicator() {
  const status = useConnectionStatus();
  const s = STATUS[status];
  return (
    <Tooltip content={s.hint}>
      <span className={styles.connection} role="status" aria-label={`Realtime: ${s.label}`} tabIndex={0}>
        <StatusDot color={s.color} pulse={status === 'open'} />
        <span className={styles.connectionLabel}>{s.label}</span>
      </span>
    </Tooltip>
  );
}

/** Default trail from the route when a page sets none. */
function routeCrumbs(pathname: string): Crumb[] {
  if (pathname.startsWith('/account')) return [{ label: 'Account' }];
  if (pathname.startsWith('/admin')) return [{ label: 'Admin' }];
  const map = /^\/m\/([^/]+)(\/settings)?/.exec(pathname);
  if (map) {
    const crumbs: Crumb[] = [
      { label: 'Maps', to: '/' },
      { label: decodeURIComponent(map[1]!), to: `/m/${map[1]}` },
    ];
    if (map[2]) crumbs.push({ label: 'Settings' });
    return crumbs;
  }
  return [{ label: 'Maps' }];
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const items = useBreadcrumbItems() ?? routeCrumbs(pathname);
  // Phones show only the current page, with a back link to its parent.
  const parent = items.length > 1 ? items[items.length - 2] : undefined;
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs} data-nested={parent?.to ? '' : undefined}>
      {parent?.to && (
        <Link to={parent.to} className={styles.back} aria-label={`Back to ${parent.label}`}>
          <ChevronLeft aria-hidden />
        </Link>
      )}
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {i > 0 && <ChevronRight className={styles.crumbSep} aria-hidden />}
              {c.to && !last ? (
                <Link to={c.to}>{c.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/**
 * The signed-in frame: a slim rail on the left (bottom tabs on phones) and a top bar with the
 * breadcrumb, live status, theme switch and account menu.
 */
export function AppShell({ me, children }: { me: MeDto; children: ReactNode }) {
  const realtime = useRealtime();
  const { refresh: refreshTheme } = useTheme();
  const demo = useDemoMode();
  const admin = isInstanceAdmin(me);
  const accountId = me.account.id;
  const lastAccount = useRef<string | null>(null);
  const { pathname } = useLocation();
  // The map is a full-screen tool; on phones its own dock replaces the tab bar.
  const immersive = /^\/m\/[^/]+\/?$/.test(pathname);

  // The socket authenticates with the session cookie at connect time; reconnect when it changes.
  // The account's own theme choice is read again at the same moment.
  useEffect(() => {
    if (lastAccount.current === accountId) return;
    const wasKnown = lastAccount.current !== null;
    lastAccount.current = accountId;
    refreshTheme();
    if (wasKnown) realtime.reconnect();
  }, [accountId, realtime, refreshTheme]);

  const nav: NavItem[] = [
    { to: '/', label: 'Maps', icon: <MapIcon />, end: true },
    ...(admin ? [{ to: '/admin', label: 'Admin', icon: <Shield /> }] : []),
  ];
  const mobileNav: NavItem[] = [...nav, { to: '/account', label: 'Account', icon: <UserRound /> }];

  return (
    <PluginsProvider enabled>
      <BreadcrumbProvider>
        <div className={styles.shell} data-immersive={immersive || undefined}>
          <a href="#main" className={styles.skip}>
            Skip to content
          </a>
          <nav className={styles.rail} aria-label="Main">
            <Link to="/" className={styles.logo} aria-label="Wormwright home">
              <LogoMark size={26} />
            </Link>
            {nav.map((item) => (
              <Tooltip key={item.to} content={item.label} side="right">
                <NavLink to={item.to} end={item.end} className={styles.railLink} aria-label={item.label}>
                  {item.icon}
                </NavLink>
              </Tooltip>
            ))}
          </nav>
          <header className={styles.topbar}>
            <Link to="/" className={styles.mobileLogo} aria-label="Wormwright home">
              <LogoMark size={22} />
            </Link>
            <Breadcrumbs />
            <span className={styles.spacer} />
            {demo && (
              <Tooltip content="Demo mode: everyone who opens this instance shares one demo account.">
                <span tabIndex={0} className={styles.demo}>
                  <Badge tone="warning" dot>
                    Demo<span className={styles.demoWord}> mode</span>
                  </Badge>
                </span>
              </Tooltip>
            )}
            <ConnectionIndicator />
            <ThemeMenu />
            <AccountMenu me={me} />
          </header>
          <main id="main" className={styles.main} tabIndex={-1}>
            {children}
          </main>
          <nav className={styles.tabbar} aria-label="Main">
            {mobileNav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={styles.tab}>
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </BreadcrumbProvider>
    </PluginsProvider>
  );
}
