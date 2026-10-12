'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';

/**
 * True when `href` is the current page (or, unless `end`, a page below it), or the page is under
 * one of `also` (the Map tab is current on every map and on All maps).
 */
export function isActive(pathname: string, href: string, end = false, also: readonly string[] = []): boolean {
  if (
    also.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
    )
  )
    return true;
  if (end || href === '/') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A link that marks itself `aria-current="page"` on its page. It reads the URL, so in the static
 * shell it sits in a Suspense boundary whose fallback is the same link without the mark.
 */
export function NavLink({
  end,
  also,
  ...props
}: ComponentProps<typeof Link> & { href: string; end?: boolean; also?: readonly string[] }) {
  const pathname = usePathname();
  return <Link {...props} aria-current={isActive(pathname, props.href, end, also) ? 'page' : undefined} />;
}
