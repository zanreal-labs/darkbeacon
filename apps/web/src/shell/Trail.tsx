'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBreadcrumbItems, type Crumb } from './breadcrumbs';
import { MapSwitcher } from './MapSwitcher';
import styles from './AppShell.module.css';

/** Default trail from the route when a page sets none. */
export function routeCrumbs(pathname: string): Crumb[] {
  if (pathname.startsWith('/account')) return [{ label: 'Account' }];
  if (pathname.startsWith('/admin')) return [{ label: 'Admin' }];
  if (pathname.startsWith('/maps')) return [{ label: 'All maps' }];
  // The same trail the page sets, so the server's first HTML already matches it.
  if (pathname.startsWith('/import'))
    return [{ label: 'All maps', to: '/maps' }, { label: 'Import from Wanderer' }];
  if (pathname.startsWith('/dev')) return [{ label: 'Components' }];
  const map = /^\/m\/([^/]+)/.exec(pathname);
  if (map) return [{ label: decodeURIComponent(map[1]!), to: `/m/${map[1]}` }];
  return [{ label: 'Map' }];
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const map = /^\/m\/([^/]+)/.exec(pathname);
  // On a map the map's name is the switcher (its settings open over the map, from the rail).
  if (map) {
    return (
      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
        <ol>
          <li>
            <MapSwitcher slug={decodeURIComponent(map[1]!)} />
          </li>
        </ol>
      </nav>
    );
  }
  return <Trail pathname={pathname} />;
}

function Trail({ pathname }: { pathname: string }) {
  const items = useBreadcrumbItems() ?? routeCrumbs(pathname);
  // Phones show only the current page, with a back link to its parent.
  const parent = items.length > 1 ? items[items.length - 2] : undefined;
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs} data-nested={parent?.to ? '' : undefined}>
      {parent?.to && (
        <Link href={parent.to} className={styles.back} aria-label={`Back to ${parent.label}`}>
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
                <Link href={c.to}>{c.label}</Link>
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
