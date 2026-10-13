import Link from 'next/link';
import { Suspense, type ReactElement, type ReactNode } from 'react';
import { Map as MapIcon, Orbit, Shield, UserRound, UsersRound } from 'lucide-react';
import { PluginsProvider } from '../plugins/PluginSlot';
import { Skeleton, Tooltip } from '../ui';
import { Breadcrumbs } from './Trail';
import { BreadcrumbProvider } from './breadcrumbs';
import { ConnectionIndicator } from './ConnectionIndicator';
import { EveStatus } from './EveStatus';
import { HelpMenu } from './HelpMenu';
import { LogoMark } from './Logo';
import { MapSettingsRailButton } from './MapSettingsButton';
import { NavLink } from './NavLink';
import { NewVersion } from './NewVersion';
import { TelemetryRoot } from './Telemetry';
import { ThemeMenu } from './ThemeMenu';
import styles from './AppShell.module.css';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  /** Other paths the item counts as current on. */
  also?: readonly string[];
}

/** A rail icon link; static in the prerendered shell, marked current once the URL is known. */
export function RailLink({ item }: { item: NavItem }) {
  const link = (current: boolean) =>
    current ? (
      <NavLink
        href={item.href}
        end={item.end}
        also={item.also}
        className={styles.railLink}
        aria-label={item.label}
      >
        {item.icon}
      </NavLink>
    ) : (
      <Link href={item.href} className={styles.railLink} aria-label={item.label}>
        {item.icon}
      </Link>
    );
  const tip = (child: ReactElement) => (
    <Tooltip content={item.label} side="right">
      {child}
    </Tooltip>
  );
  return <Suspense fallback={tip(link(false))}>{tip(link(true))}</Suspense>;
}

/** A tab of the phone tab bar, like `RailLink`. */
export function TabLink({ item }: { item: NavItem }) {
  const body = (
    <>
      {item.icon}
      <span>{item.label}</span>
    </>
  );
  return (
    <Suspense
      fallback={
        <Link href={item.href} className={styles.tab}>
          {body}
        </Link>
      }
    >
      <NavLink href={item.href} end={item.end} also={item.also} className={styles.tab}>
        {body}
      </NavLink>
    </Suspense>
  );
}

/** Goes to `/`, which opens the account's map straight away (All maps is in the map switcher). */
export const MAPS_NAV: NavItem = {
  href: '/',
  label: 'Map',
  icon: <MapIcon />,
  end: true,
  also: ['/m/', '/maps'],
};
/** The jump planner: its own map, of all known space. */
export const JUMP_NAV: NavItem = { href: '/jump', label: 'Jump planner', icon: <Orbit /> };
export const ADMIN_NAV: NavItem = { href: '/admin', label: 'Admin', icon: <Shield /> };
export const ACCOUNT_NAV: NavItem = { href: '/account', label: 'Account', icon: <UserRound /> };
/** My characters: where they are, their scopes, and which maps track them. */
export const CHARACTERS_NAV: NavItem = { href: '/characters', label: 'Characters', icon: <UsersRound /> };

/**
 * The signed-in frame: a slim rail on the left (bottom tabs on phones) and a top bar with the
 * breadcrumb, live status, theme switch and account menu. Everything here is static and part of
 * the prerendered shell; the parts that need the account arrive through the slots, each behind
 * its own Suspense boundary.
 */
export function AppShell({
  account,
  adminRail,
  adminTab,
  demoBadge,
  children,
}: {
  account: ReactNode;
  adminRail: ReactNode;
  adminTab: ReactNode;
  demoBadge: ReactNode;
  children: ReactNode;
}) {
  return (
    <PluginsProvider enabled>
      <BreadcrumbProvider>
        <div className={styles.shell}>
          <a href="#main" className={styles.skip}>
            Skip to content
          </a>
          <nav className={styles.rail} aria-label="Main">
            <Link href="/" className={styles.logo} aria-label="Darkbeacon home">
              <LogoMark size={26} />
            </Link>
            <RailLink item={MAPS_NAV} />
            {/* Reads the URL and the map's role, so it waits for both; nothing shows meanwhile. */}
            <Suspense fallback={null}>
              <MapSettingsRailButton />
            </Suspense>
            <RailLink item={JUMP_NAV} />
            <RailLink item={CHARACTERS_NAV} />
            {adminRail}
            <HelpMenu placement="rail" />
          </nav>
          <header className={styles.topbar}>
            <Link href="/" className={styles.mobileLogo} aria-label="Darkbeacon home">
              <LogoMark size={22} />
            </Link>
            <Suspense fallback={<Skeleton width={120} height={12} />}>
              <Breadcrumbs />
            </Suspense>
            <span className={styles.spacer} />
            {demoBadge}
            <EveStatus />
            <ConnectionIndicator />
            <HelpMenu placement="topbar" />
            <ThemeMenu />
            {account}
          </header>
          <main id="main" className={styles.main} tabIndex={-1}>
            {children}
          </main>
          <nav className={styles.tabbar} aria-label="Main">
            <TabLink item={MAPS_NAV} />
            <TabLink item={{ ...JUMP_NAV, label: 'Jumps' }} />
            {adminTab}
            <TabLink item={ACCOUNT_NAV} />
          </nav>
          <Suspense fallback={null}>
            <TelemetryRoot />
          </Suspense>
          <NewVersion />
        </div>
      </BreadcrumbProvider>
    </PluginsProvider>
  );
}

export function AccountPlaceholder() {
  return <span className={styles.accountPlaceholder} aria-hidden />;
}
