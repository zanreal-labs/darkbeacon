'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBreadcrumbItems, type Crumb } from './breadcrumbs';
import styles from './AppShell.module.css';

/** Default trail from the route when a page sets none. */
export function routeCrumbs(pathname: string): Crumb[] {
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

export function Breadcrumbs() {
  const pathname = usePathname();
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
