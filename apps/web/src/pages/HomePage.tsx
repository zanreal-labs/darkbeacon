import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type CreateMapRequest, type MapDto, type MapSummaryDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import styles from './pages.module.css';

/** `My Chain 2` -> `my-chain-2`; the server validates again. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function HomePage() {
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  const [creating, setCreating] = useState(false);

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <h1>Maps</h1>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            New map
          </button>
        )}
      </div>

      {creating && <CreateMap onCancel={() => setCreating(false)} />}

      <div className={styles.section}>
        {maps.isPending && <p className="muted">Loading…</p>}
        {maps.isError && <p className="error">Maps could not be loaded.</p>}
        {maps.data?.length === 0 && (
          <p className="muted">No maps yet. Create one, or ask a map admin to give you access.</p>
        )}
        <ul className={styles.rows}>
          {maps.data?.map((m) => (
            <li key={m.id} className={styles.row}>
              <Link to={`/m/${m.slug}`} className={`${styles.mapLink} ${styles.grow}`}>
                {m.name}
              </Link>
              <span className={styles.pill}>{m.role}</span>
              {m.role === 'admin' && (
                <Link to={`/m/${m.slug}/settings`} className="btn btn-small btn-ghost">
                  Settings
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CreateMap({ onCancel }: { onCancel(): void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const shownSlug = slug ?? slugify(name);

  const create = useMutation({
    mutationFn: (body: CreateMapRequest) =>
      api<MapDto>(routes.maps.create.path, { method: 'POST', json: body }),
    onSuccess: (map) => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      void navigate(`/m/${map.slug}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), ...(shownSlug.length >= 2 ? { slug: shownSlug } : {}) });
  };

  return (
    <form className={styles.section} onSubmit={submit} aria-label="New map">
      <h2>New map</h2>
      <div className={styles.inline}>
        <label className={`field ${styles.field}`}>
          <span>Name</span>
          <input
            className="input"
            required
            maxLength={64}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={`field ${styles.field}`}>
          <span>Address: /m/{shownSlug || '…'}</span>
          <input
            className="input"
            maxLength={48}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={shownSlug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !name.trim()}>
          Create
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {create.error && (
        <p className="error">
          {create.error instanceof ApiError ? create.error.message : 'Could not create the map.'}
        </p>
      )}
    </form>
  );
}
