import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** The tab lives in `?tab=` so it survives a reload and can be linked. */
export function useTabParam<T extends string>(ids: readonly T[], fallback: T): [T, (tab: string) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = params.get('tab');
  const tab = ids.includes(raw as T) ? (raw as T) : fallback;
  const set = (next: string) => {
    const copy = new URLSearchParams(params);
    if (next === fallback) copy.delete('tab');
    else copy.set('tab', next);
    const query = copy.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return [tab, set];
}
