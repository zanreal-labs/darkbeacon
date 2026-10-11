import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccessSubjectKind,
  buildPath,
  MapRole,
  MapScope,
  routes,
  type AccessRuleDto,
  type CreateAccessRuleRequest,
  type LabelDto,
  type MapDto,
  type MapSummaryDto,
  type UpdateMapRequest,
} from '@wormwright/shared';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { mapPermissions } from '../lib/roles';
import styles from './pages.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function MapSettingsPage() {
  const { slug = '' } = useParams();
  const map = useQuery({
    queryKey: ['map', slug],
    queryFn: () => api<MapDto>(buildPath(routes.maps.bySlug.path, { slug })),
    retry: false,
  });
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  if (map.isPending || maps.isPending) return <p className={`${styles.page} muted`}>Loading…</p>;
  if (!map.data) return <p className={`${styles.page} error`}>This map is not available.</p>;
  const can = mapPermissions(maps.data?.find((m) => m.id === map.data.id)?.role);
  if (!can.manage) return <Navigate to={`/m/${slug}`} replace />;

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <h1>{map.data.name} · settings</h1>
        <Link to={`/m/${map.data.slug}`} className="btn">
          Open map
        </Link>
      </div>
      {can.admin && <GeneralSettings map={map.data} />}
      <LabelSettings map={map.data} />
      {can.admin && <AccessRules map={map.data} />}
      {can.admin && <DeleteMap map={map.data} />}
    </section>
  );
}

function useMapUpdated() {
  const queryClient = useQueryClient();
  return (map: MapDto) => {
    queryClient.setQueryData(['map', map.slug], map);
    void queryClient.invalidateQueries({ queryKey: ['maps'] });
  };
}

const SCOPE_LABEL: Record<MapScope, string> = {
  wormhole: 'Wormhole space',
  high: 'High-sec',
  low: 'Low-sec',
  null: 'Null-sec',
  pochven: 'Pochven',
};

function GeneralSettings({ map }: { map: MapDto }) {
  const navigate = useNavigate();
  const updated = useMapUpdated();
  const [name, setName] = useState(map.name);
  const [slug, setSlug] = useState(map.slug);
  const [scopes, setScopes] = useState<MapScope[]>(map.settings.scopes);
  const save = useMutation({
    mutationFn: (body: UpdateMapRequest) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), { method: 'PATCH', json: body }),
    onSuccess: (next) => {
      updated(next);
      if (next.slug !== map.slug) void navigate(`/m/${next.slug}/settings`, { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name: name.trim(), slug, settings: { scopes } });
  };

  return (
    <form className={styles.section} onSubmit={submit} aria-label="General">
      <h2>General</h2>
      <div className={styles.inline}>
        <label className={`field ${styles.field}`}>
          <span>Name</span>
          <input
            className="input"
            required
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={`field ${styles.field}`}>
          <span>Address: /m/{slug}</span>
          <input
            className="input"
            required
            minLength={2}
            maxLength={48}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
      </div>
      <fieldset className={styles.section} style={{ marginTop: 'var(--ww-space-3)' }}>
        <legend className="muted">Auto-mapping adds systems in</legend>
        <div className={styles.inline}>
          {MapScope.options.map((s) => (
            <label key={s} className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
              />
              {SCOPE_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.inline} style={{ marginTop: 'var(--ww-space-3)' }}>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          Save
        </button>
        {save.isSuccess && <span className="muted">Saved.</span>}
        {save.error && <span className="error">{errorText(save.error, 'Could not save.')}</span>}
      </div>
    </form>
  );
}

const newLabel = (): LabelDto => ({ id: crypto.randomUUID(), name: '', color: '#5b93f0', description: '' });

function LabelSettings({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const [labels, setLabels] = useState<LabelDto[]>(map.labels);
  const save = useMutation({
    mutationFn: (list: LabelDto[]) =>
      api<LabelDto[]>(buildPath(routes.maps.setLabels.path, { mapId: map.id }), {
        method: 'PUT',
        json: { labels: list },
      }),
    onSuccess: (list) => {
      setLabels(list);
      queryClient.setQueryData(['map', map.slug], { ...map, labels: list });
    },
  });
  const change = (id: string, patch: Partial<LabelDto>) =>
    setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(labels.map((l) => ({ ...l, name: l.name.trim() })).filter((l) => l.name));
  };

  return (
    <form className={styles.section} onSubmit={submit} aria-label="Labels">
      <h2>Labels</h2>
      <p className="muted">Shown on systems. The description appears when someone hovers the label.</p>
      {labels.map((l) => (
        <div key={l.id} className={styles.labelRow}>
          <input
            type="color"
            className={styles.color}
            aria-label="Colour"
            value={l.color}
            onChange={(e) => change(l.id, { color: e.target.value })}
          />
          <input
            className="input"
            aria-label="Label name"
            placeholder="Name"
            maxLength={32}
            value={l.name}
            onChange={(e) => change(l.id, { name: e.target.value })}
          />
          <input
            className="input"
            aria-label="Description"
            placeholder="Description"
            maxLength={500}
            value={l.description}
            onChange={(e) => change(l.id, { description: e.target.value })}
          />
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-label={`Remove label ${l.name}`}
            onClick={() => setLabels((ls) => ls.filter((x) => x.id !== l.id))}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className={styles.inline} style={{ marginTop: 'var(--ww-space-2)' }}>
        <button
          type="button"
          className="btn"
          onClick={() => setLabels((ls) => [...ls, newLabel()])}
          disabled={labels.length >= 64}
        >
          <Icon name="plus" size={12} /> Add label
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          Save labels
        </button>
        {save.isSuccess && <span className="muted">Saved.</span>}
        {save.error && <span className="error">{errorText(save.error, 'Could not save the labels.')}</span>}
      </div>
    </form>
  );
}

const SUBJECT_LABEL: Record<AccessSubjectKind, string> = {
  discordRole: 'Discord role',
  character: 'Character',
  corporation: 'Corporation',
  alliance: 'Alliance',
  account: 'Account',
};

function AccessRules({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const key = ['access-rules', map.id];
  const rules = useQuery({
    queryKey: key,
    queryFn: () => api<AccessRuleDto[]>(buildPath(routes.access.list.path, { mapId: map.id })),
  });
  const [draft, setDraft] = useState<CreateAccessRuleRequest>({
    subjectKind: 'corporation',
    subjectId: '',
    guildId: null,
    role: 'member',
  });
  const add = useMutation({
    mutationFn: (body: CreateAccessRuleRequest) =>
      api<AccessRuleDto>(buildPath(routes.access.add.path, { mapId: map.id }), {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => {
      setDraft((d) => ({ ...d, subjectId: '' }));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      api<void>(buildPath(routes.access.remove.path, { mapId: map.id, ruleId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({
      ...draft,
      subjectId: draft.subjectId.trim(),
      guildId: draft.subjectKind === 'discordRole' ? draft.guildId?.trim() || null : null,
    });
  };

  return (
    <div className={styles.section}>
      <h2>Access</h2>
      <p className="muted">
        The highest matching rule wins. A blocked character or account is refused regardless of other rules.
      </p>
      {rules.data?.length === 0 && <p className="muted">Only the owner can see this map.</p>}
      <ul className={styles.rows}>
        {rules.data?.map((r) => (
          <li key={r.id} className={styles.row}>
            <span className={styles.pill}>{SUBJECT_LABEL[r.subjectKind]}</span>
            <span className={styles.grow}>
              <code>{r.subjectId}</code>
              {r.guildId && <span className="muted"> in guild {r.guildId}</span>}
            </span>
            <strong>{r.role}</strong>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              aria-label="Remove rule"
              onClick={() => remove.mutate(r.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.inline}
        onSubmit={submit}
        aria-label="Add access rule"
        style={{ marginTop: 'var(--ww-space-3)' }}
      >
        <label className={`field ${styles.field}`}>
          <span>Who</span>
          <select
            className="input"
            value={draft.subjectKind}
            onChange={(e) => setDraft({ ...draft, subjectKind: e.target.value as AccessSubjectKind })}
          >
            {AccessSubjectKind.options.map((k) => (
              <option key={k} value={k}>
                {SUBJECT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {draft.subjectKind === 'discordRole' && (
          <label className={`field ${styles.field}`}>
            <span>Guild id</span>
            <input
              className="input"
              required
              value={draft.guildId ?? ''}
              onChange={(e) => setDraft({ ...draft, guildId: e.target.value })}
            />
          </label>
        )}
        <label className={`field ${styles.field}`}>
          <span>{draft.subjectKind === 'discordRole' ? 'Role id' : 'Id'}</span>
          <input
            className="input"
            required
            value={draft.subjectId}
            onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}
          />
        </label>
        <label className={`field ${styles.field}`}>
          <span>Map role</span>
          <select
            className="input"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as MapRole })}
          >
            {MapRole.options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>
          Add rule
        </button>
      </form>
      {(add.error ?? remove.error ?? rules.error) && (
        <p className="error">
          {errorText(add.error ?? remove.error ?? rules.error, 'Something went wrong.')}
        </p>
      )}
    </div>
  );
}

function DeleteMap({ map }: { map: MapDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api<void>(buildPath(routes.maps.remove.path, { mapId: map.id }), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maps'] });
      void navigate('/', { replace: true });
    },
  });
  return (
    <div className={styles.section}>
      <h2>Delete map</h2>
      <p className="muted">Removes the map, its systems, connections and signatures for everyone.</p>
      <button
        type="button"
        className="btn btn-danger"
        disabled={remove.isPending}
        onClick={() => {
          if (window.prompt(`Type the map name (${map.name}) to delete it.`) === map.name) remove.mutate();
        }}
      >
        Delete this map
      </button>
      {remove.error && <p className="error">{errorText(remove.error, 'Could not delete the map.')}</p>}
    </div>
  );
}
