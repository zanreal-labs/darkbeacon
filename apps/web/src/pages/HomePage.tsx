import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type MapSummaryDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import styles from './HomePage.module.css';

export function HomePage() {
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });

  return (
    <section className={styles.page}>
      <h1>Maps</h1>
      {maps.isPending && <p className={styles.muted}>Loading…</p>}
      {maps.error && (
        <p className={styles.muted}>
          {maps.error instanceof ApiError && maps.error.code === 'unauthenticated'
            ? 'Sign in to see your maps.'
            : 'Maps are not available yet.'}
        </p>
      )}
      {maps.data?.length === 0 && <p className={styles.muted}>No maps yet.</p>}
      <ul className={styles.list}>
        {maps.data?.map((m) => (
          <li key={m.id}>
            <Link to={`/m/${m.slug}`}>{m.name}</Link> <span className={styles.muted}>{m.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
