'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Replaces the current page with `to` (for redirects decided in the browser). */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return null;
}
