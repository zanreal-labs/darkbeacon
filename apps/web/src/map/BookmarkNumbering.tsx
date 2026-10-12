'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  BOOKMARK_MAPPABLE_VALUES,
  BOOKMARK_ORDERS,
  BOOKMARK_PREVIEW_VARS,
  bookmarkClassLabel,
  bookmarkTemplateVariables,
  BookmarkOrder,
  buildPath,
  chainTree,
  compareBookmarkSiblings,
  DEFAULT_BOOKMARK_NUMBERING,
  numbersBookmark,
  renderBookmarkTemplate,
  routes,
  type BookmarkNumbering,
  type BookmarkSibling,
  type ConnectionDto,
  type MapDto,
  type MapSnapshot,
  type StreamSnapshotDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { mapKey } from '../lib/session-keys';
import { useUniverseSystems } from '../lib/universe';
import { Button, Card, CardBody, CardFooter, CardHeader, IconButton, Input, Switch, useToast } from '../ui';
import styles from './BookmarkSettings.module.css';

export const ORDERS = BookmarkOrder.options;

/** Templates without `{n}` preview numbering as `WH{n}`. */
export function numberingTemplate(template: string): string {
  const used = bookmarkTemplateVariables(template);
  return used.includes('n') || used.includes('N') ? template : 'WH{n}';
}

/**
 * Three wormholes out of a sample home, in the order they were found; `number` is where they
 * were put by hand.
 */
const SAMPLE: (BookmarkSibling & { sig3: string })[] = [
  { connectionId: 'x', createdAt: 1, signature: 'XYZ-777', sig3: 'XYZ', destClass: 'HS', number: 3 },
  { connectionId: 'a', createdAt: 2, signature: 'ABC-123', sig3: 'ABC', destClass: 'C3', number: 1 },
  { connectionId: 'k', createdAt: 3, signature: null, sig3: '', destClass: 'LS', number: 2 },
];

function sampleLabel(
  template: string,
  sibling: (typeof SAMPLE)[number],
  n: number,
  numbering: Pick<BookmarkNumbering, 'startAtZero' | 'values'> = {},
): string {
  const shown = numbering.startAtZero ? n - 1 : n;
  return renderBookmarkTemplate(
    template,
    {
      ...BOOKMARK_PREVIEW_VARS,
      sig: sibling.signature ?? '',
      sig3: sibling.sig3,
      destClass: sibling.destClass,
      n: String(shown),
      N: String(shown).padStart(2, '0'),
      letter: String.fromCharCode(64 + n),
    },
    numbering.values,
  );
}

/**
 * The sample chain numbered in `order`, and what happens when its second wormhole closes: a
 * gap the next new wormhole fills, or the others closing up.
 */
export function NumberingPreview({
  numbering,
  template,
}: {
  numbering: BookmarkNumbering;
  template: string;
}) {
  const shown = numberingTemplate(template);
  const sorted = [...SAMPLE].sort(compareBookmarkSiblings(numbering.order));
  const numbered = sorted.map((s, i) => ({ ...s, n: i + 1 }));
  const left = numbered.filter((s) => s.n !== 2);
  const after = numbering.renumberOnClose ? left.map((s, i) => ({ ...s, n: i + 1 })) : left;

  return (
    <div className={styles.numberingPreview} aria-live="polite" aria-label="Numbering preview">
      <div className={styles.sampleChain}>
        <span className={styles.sampleHome}>Home</span>
        <ul className={styles.sampleHoles}>
          {numbered.map((s) => (
            <li key={s.connectionId}>
              <span className={styles.tag}>{sampleLabel(shown, s, s.n, numbering) || '—'}</span>
              <span className={styles.sampleFacts}>
                {s.signature ?? 'no signature yet'} · {s.destClass}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.preview}>
        <span className={styles.previewLabel}>
          When {sampleLabel(shown, numbered[1]!, 2, numbering)} closes
        </span>
        {after.map((s) => (
          <span key={s.connectionId} className={styles.tag}>
            {sampleLabel(shown, s, s.n, numbering)}
          </span>
        ))}
        {!numbering.renumberOnClose && (
          <span className={styles.previewLabel}>
            the next new one is {sampleLabel(shown, numbered[1]!, 2, numbering)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Order radio cards, shared by the map's numbering and the viewer's own. */
export function OrderPicker({
  value,
  onChange,
  label,
  disabled,
  follow,
}: {
  value: BookmarkOrder | null;
  onChange(order: BookmarkOrder | null): void;
  label: string;
  disabled?: boolean;
  /** Offer "the map's order" (null) first, naming it. */
  follow?: BookmarkOrder;
}) {
  return (
    <div className={styles.orders} role="radiogroup" aria-label={label}>
      {follow && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          disabled={disabled}
          className={styles.preset}
          onClick={() => onChange(null)}
        >
          <span className={styles.optionTitle}>Same as the map</span>
          <span className={styles.optionText}>{BOOKMARK_ORDERS[follow].label}, shared with everyone</span>
        </button>
      )}
      {ORDERS.map((order) => (
        <button
          key={order}
          type="button"
          role="radio"
          aria-checked={value === order}
          disabled={disabled}
          className={styles.preset}
          onClick={() => onChange(order)}
        >
          <span className={styles.optionTitle}>{BOOKMARK_ORDERS[order].label}</span>
          <span className={styles.optionText}>{BOOKMARK_ORDERS[order].description}</span>
        </button>
      ))}
    </div>
  );
}

interface Sibling {
  connection: ConnectionDto;
  child: number;
  number: number;
}

/**
 * The map's numbered wormholes, per system with more than one, with up and down to swap
 * numbers. Read from a snapshot; the map itself follows the changes live.
 */
function ManualOrder({ mapId, canEdit }: { mapId: string; canEdit: boolean }) {
  const toast = useToast();
  const client = useQueryClient();
  const key = ['bookmark-numbers', mapId];
  const snapshot = useQuery({
    queryKey: key,
    queryFn: () =>
      api<StreamSnapshotDto>(buildPath(routes.realtime.snapshot.path, { stream: `map:${mapId}` })),
  });
  const [busy, setBusy] = useState<string | null>(null);

  const groups = useMemo(() => {
    const data = snapshot.data?.data as Partial<MapSnapshot> | undefined;
    if (!data?.systems || !data.connections) return [];
    const byParent = new Map<number, Sibling[]>();
    for (const { parent, child, connection } of chainTree(data.systems, data.connections).steps) {
      if (!numbersBookmark(connection) || connection.bookmarkParent !== parent || !connection.bookmarkNumber)
        continue;
      byParent.set(parent, [
        ...(byParent.get(parent) ?? []),
        { connection, child, number: connection.bookmarkNumber },
      ]);
    }
    return [...byParent]
      .filter(([, siblings]) => siblings.length > 1)
      .map(([parent, siblings]) => ({ parent, siblings: siblings.sort((a, b) => a.number - b.number) }));
  }, [snapshot.data]);
  const ids = useMemo(
    () => [...new Set(groups.flatMap((g) => [g.parent, ...g.siblings.map((s) => s.child)]))],
    [groups],
  );
  const universe = useUniverseSystems(ids);
  const name = (id: number) => universe.get(id)?.name ?? String(id);

  const move = async (sibling: Sibling, to: number) => {
    setBusy(sibling.connection.id);
    try {
      await api(
        buildPath(routes.connections.setBookmarkNumber.path, { mapId, connectionId: sibling.connection.id }),
        { method: 'PUT', json: { number: to } },
      );
      await client.invalidateQueries({ queryKey: key });
    } catch (error) {
      toast({
        title: 'Could not move the number',
        description: error instanceof ApiError ? error.message : undefined,
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  if (snapshot.isPending) return null;
  if (groups.length === 0)
    return <p className={styles.optionText}>No system has more than one numbered wormhole out of it yet.</p>;
  return (
    <div className={styles.manual} aria-label="Numbers by hand">
      {groups.map(({ parent, siblings }) => (
        <div key={parent} className={styles.manualGroup}>
          <span className={styles.previewLabel}>Out of {name(parent)}</span>
          <ol className={styles.manualList}>
            {siblings.map((s, i) => {
              const target = name(s.child);
              const cls = bookmarkClassLabel(universe.get(s.child));
              return (
                <li key={s.connection.id} className={styles.manualRow}>
                  <span className={styles.tag}>{s.number}</span>
                  <span className={styles.manualName}>
                    {target}
                    {cls && cls !== target && <span className={styles.optionText}> {cls}</span>}
                  </span>
                  {canEdit && (
                    <span className={styles.manualMoves}>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={<ArrowUp />}
                        label={`Move ${target} up`}
                        disabled={i === 0 || busy !== null}
                        onClick={() => void move(s, siblings[i - 1]!.number)}
                      />
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={<ArrowDown />}
                        label={`Move ${target} down`}
                        disabled={i === siblings.length - 1 || busy !== null}
                        onClick={() => void move(s, siblings[i + 1]!.number)}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * `{n}`: how the wormholes out of each system are numbered, for everyone. Managers choose the
 * order and whether numbers close up when a wormhole closes; members may renumber at once.
 */
export function BookmarkNumberingCard({
  map,
  canManage,
  canEdit,
  template,
}: {
  map: MapDto;
  canManage: boolean;
  canEdit: boolean;
  /** The template being edited, for the preview. */
  template: string;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const fromMap = map.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING;
  // What this card saved last, until the map it was given changes.
  const [stored, setStored] = useState<BookmarkNumbering | null>(null);
  const saved = stored ?? fromMap;
  const [draft, setDraft] = useState<BookmarkNumbering>(fromMap);
  // A newer map (refetched, or changed by another manager) resets the draft.
  const fromMapKey = JSON.stringify(fromMap);
  const [seen, setSeen] = useState(fromMapKey);
  if (seen !== fromMapKey) {
    setSeen(fromMapKey);
    setStored(null);
    setDraft(fromMap);
  }
  const [busy, setBusy] = useState<'save' | 'renumber' | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    setBusy('save');
    try {
      const next = await api<MapDto>(buildPath(routes.maps.setBookmarkNumbering.path, { mapId: map.id }), {
        method: 'PUT',
        json: { numbering: draft },
      });
      client.setQueryData(mapKey(next.slug), next);
      const numbering = next.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING;
      setStored(numbering);
      setDraft(numbering);
      await client.invalidateQueries({ queryKey: ['bookmark-numbers', map.id] });
      toast({ title: 'Numbering saved', tone: 'success' });
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof ApiError ? error.message : undefined,
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  const renumber = async () => {
    setBusy('renumber');
    try {
      await api(buildPath(routes.maps.renumberBookmarks.path, { mapId: map.id }), {
        method: 'POST',
        json: {},
      });
      await client.invalidateQueries({ queryKey: ['bookmark-numbers', map.id] });
      toast({ title: 'Wormholes renumbered', tone: 'success' });
    } catch (error) {
      toast({
        title: 'Could not renumber',
        description: error instanceof ApiError ? error.message : undefined,
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Numbering"
        description="{n} counts the wormholes out of each system: WH1, WH2, WH3. Numbers are the same for everyone and stay put when a wormhole closes."
      />
      <CardBody>
        <div className={styles.picker}>
          <OrderPicker
            label="Numbering order"
            value={draft.order}
            onChange={(order) => order && setDraft({ ...draft, order })}
            disabled={!canManage}
          />
          <Switch
            checked={draft.renumberOnClose}
            onCheckedChange={(renumberOnClose) => setDraft({ ...draft, renumberOnClose })}
            disabled={!canManage}
            label="Renumber when a wormhole closes"
            description={
              draft.renumberOnClose
                ? 'The others close up, so the numbers stay 1, 2, 3.'
                : 'Off: the others keep their numbers and the next new wormhole takes the free one.'
            }
          />
          <Switch
            checked={draft.startAtZero ?? false}
            onCheckedChange={(startAtZero) => setDraft({ ...draft, startAtZero })}
            disabled={!canManage}
            label="Count from 0"
            description="{n} of the first wormhole is 0 ({letter} still starts at A)."
          />
          <ValueMappings
            values={draft.values ?? {}}
            disabled={!canManage}
            onChange={(values) => setDraft({ ...draft, values })}
          />
          <NumberingPreview numbering={draft} template={template} />
          {/* A composite counts in its order as its viewers look: stored numbers are its sources'. */}
          {saved.order === 'manual' && map.kind !== 'composite' && (
            <ManualOrder mapId={map.id} canEdit={canEdit} />
          )}
        </div>
      </CardBody>
      {(canEdit || canManage) && (
        <CardFooter>
          {canEdit && map.kind !== 'composite' && (
            <Button
              variant="ghost"
              loading={busy === 'renumber'}
              disabled={busy !== null}
              onClick={() => void renumber()}
            >
              Renumber now
            </Button>
          )}
          {canManage && (
            <Button
              variant="primary"
              loading={busy === 'save'}
              disabled={!dirty || busy !== null}
              onClick={() => void save()}
            >
              Save numbering
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

/**
 * What the values of `{destClass}`, `{size}`, `{mass}`, `{eol}`, `{direction}` and `{spawn}` are
 * written as in bookmark labels (Wanderer's value mappings): `HS` as `H`, `L` as nothing...
 * An unchanged value keeps its own text.
 */
function ValueMappings({
  values,
  disabled,
  onChange,
}: {
  values: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange(values: Record<string, string>): void;
}) {
  const set = (key: string, text: string | null) => {
    const next = { ...values };
    if (text === null) delete next[key];
    else next[key] = text;
    onChange(next);
  };
  return (
    <details className={styles.mappings}>
      <summary>
        Write values as… {Object.keys(values).length > 0 && `(${Object.keys(values).length} changed)`}
      </summary>
      <div className={styles.mappingGrid}>
        {(Object.entries(BOOKMARK_MAPPABLE_VALUES) as [string, readonly string[]][]).map(
          ([variable, list]) => (
            <fieldset key={variable} className={styles.mappingGroup} disabled={disabled}>
              <legend className="mono">{`{${variable}}`}</legend>
              {list.map((value) => {
                const key = `${variable}:${value}`;
                const mapped = Object.hasOwn(values, key);
                return (
                  <label key={key} className={styles.mappingRow}>
                    <span className="mono">{value}</span>
                    <Input
                      size="sm"
                      mono
                      aria-label={`${variable} ${value} written as`}
                      placeholder={value}
                      maxLength={16}
                      value={mapped ? values[key] : ''}
                      onChange={(e) => set(key, e.target.value === '' ? null : e.target.value)}
                    />
                    {mapped && (
                      <button type="button" className={styles.mappingClear} onClick={() => set(key, null)}>
                        Reset
                      </button>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ),
        )}
      </div>
      <p className="subtle">Empty keeps the value as it is. To drop a value, write a single space.</p>
    </details>
  );
}
