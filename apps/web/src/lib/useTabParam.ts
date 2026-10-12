import { useSearchParams } from 'react-router';

/** The tab lives in `?tab=` so it survives a reload and can be linked. */
export function useTabParam<T extends string>(ids: readonly T[], fallback: T): [T, (tab: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = ids.includes(raw as T) ? (raw as T) : fallback;
  const set = (next: string) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p);
        if (next === fallback) copy.delete('tab');
        else copy.set('tab', next);
        return copy;
      },
      { replace: true },
    );
  return [tab, set];
}
