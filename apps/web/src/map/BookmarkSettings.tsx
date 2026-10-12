'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BOOKMARK_PREVIEW_VARS,
  BOOKMARK_TEMPLATE_PRESETS,
  BOOKMARK_VARIABLES,
  BookmarkTemplate,
  buildPath,
  DEFAULT_BOOKMARK_TEMPLATE,
  renderBookmarkTemplate,
  DEFAULT_BOOKMARK_NUMBERING,
  routes,
  type BookmarkOrder,
  type BookmarkVariable,
  type MapDto,
  type UpdateMapPreferencesRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { mapKey } from '../lib/session-keys';
import { Button, Card, CardBody, CardFooter, CardHeader, Input, useToast } from '../ui';
import { BookmarkNumberingCard, OrderPicker } from './BookmarkNumbering';
import { useMapPreferences } from './useMapPreferences';
import styles from './BookmarkSettings.module.css';

/** A second sample, so templates with size, mass and EOL show what they add. */
const BUSY_SAMPLE = {
  ...BOOKMARK_PREVIEW_VARS,
  sig: 'XYZ-777',
  sig3: 'XYZ',
  chainIndex: '2b',
  n: '2',
  N: '02',
  destClass: 'HS',
  type: 'B274',
  size: 'F',
  mass: 'crit',
  eol: 'EOL',
};

export function previewBookmark(template: string): [string, string] {
  return [
    renderBookmarkTemplate(template, BOOKMARK_PREVIEW_VARS),
    renderBookmarkTemplate(template, BUSY_SAMPLE),
  ];
}

function validate(template: string): string | null {
  const result = BookmarkTemplate.safeParse(template);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Not a valid template');
}

/** Ready-made templates with a live preview, and your own with the variables to pick from. */
export function TemplatePicker({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange(template: string): void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const custom = !BOOKMARK_TEMPLATE_PRESETS.includes(value);
  const [draft, setDraft] = useState(custom ? value : '');
  const error = custom && value ? validate(value) : null;
  const [a, b] = previewBookmark(value);

  return (
    <div className={styles.picker}>
      <div className={styles.presets} role="radiogroup" aria-label={label}>
        {BOOKMARK_TEMPLATE_PRESETS.map((preset) => {
          const [first] = previewBookmark(preset);
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={value === preset}
              disabled={disabled}
              className={styles.preset}
              onClick={() => onChange(preset)}
            >
              <span className={styles.tag}>{first}</span>
              <span className={styles.template}>{preset}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          disabled={disabled}
          className={styles.preset}
          onClick={() => onChange(draft || '{sig} {destClass}')}
        >
          <span className={styles.optionTitle}>Your own</span>
          <span className={styles.optionText}>Any text with variables</span>
        </button>
      </div>

      {custom && (
        <div className={styles.custom}>
          <label htmlFor={id} className={styles.customLabel}>
            Template
          </label>
          <Input
            id={id}
            mono
            maxLength={64}
            value={value}
            disabled={disabled}
            aria-invalid={!!error || undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              onChange(e.target.value);
            }}
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.variables} aria-label="Variables">
            {(Object.keys(BOOKMARK_VARIABLES) as BookmarkVariable[]).map((v) => (
              <button
                key={v}
                type="button"
                className={styles.variable}
                title={BOOKMARK_VARIABLES[v]}
                disabled={disabled}
                onClick={() => {
                  const next = `${value.trimEnd()} {${v}}`.trim();
                  setDraft(next);
                  onChange(next);
                }}
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.preview} aria-live="polite">
        <span className={styles.previewLabel}>Preview</span>
        <span className={styles.tag}>{a || '—'}</span>
        <span className={styles.tag}>{b || '—'}</span>
      </div>
    </div>
  );
}

/**
 * Bookmark labels: the map's default (managers), its `{n}` numbering and the viewer's own
 * template and order. All take effect on every open map at once.
 */
export function BookmarkLabelSettings({
  map,
  canManage,
  canEdit = canManage,
}: {
  map: MapDto;
  canManage: boolean;
  /** May renumber and move numbers by hand (members); defaults to `canManage`. */
  canEdit?: boolean;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const { preferences, settled, update } = useMapPreferences(map.id);
  const mapDefault = map.settings.bookmarkTemplate ?? DEFAULT_BOOKMARK_TEMPLATE;
  const [shared, setShared] = useState(mapDefault);
  // The map may arrive again (a refetch, another manager's change): start from the new default.
  const [seenDefault, setSeenDefault] = useState(mapDefault);
  if (seenDefault !== mapDefault) {
    setSeenDefault(mapDefault);
    setShared(mapDefault);
  }
  const [own, setOwn] = useState<string | null>(preferences.bookmarkTemplate);
  const [ownTouched, setOwnTouched] = useState(false);
  const [ownOrder, setOwnOrder] = useState<BookmarkOrder | null>(null);
  const [orderTouched, setOrderTouched] = useState(false);
  const [busy, setBusy] = useState<'map' | 'own' | null>(null);
  const ownValue = ownTouched ? own : preferences.bookmarkTemplate;
  const savedOrder = preferences.bookmarkOrder ?? null;
  const ownOrderValue = orderTouched ? ownOrder : savedOrder;
  const mapOrder = (map.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING).order;

  const saveMap = async (template: string | null) => {
    setBusy('map');
    try {
      const next = await api<MapDto>(buildPath(routes.maps.setBookmarkTemplate.path, { mapId: map.id }), {
        method: 'PUT',
        json: { template },
      });
      client.setQueryData(mapKey(next.slug), next);
      setShared(next.settings.bookmarkTemplate ?? DEFAULT_BOOKMARK_TEMPLATE);
      toast({ title: 'Map bookmark labels saved', tone: 'success' });
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

  const templateChanged = ownTouched && ownValue !== preferences.bookmarkTemplate;
  const orderChanged = orderTouched && ownOrderValue !== savedOrder;

  const saveOwn = async () => {
    setBusy('own');
    try {
      const patch: UpdateMapPreferencesRequest = {};
      if (templateChanged) patch.bookmarkTemplate = ownValue;
      if (orderChanged) patch.bookmarkOrder = ownOrderValue;
      await update(patch);
      setOwn(ownValue);
      setOwnTouched(false);
      setOrderTouched(false);
      const following = ownValue === null && ownOrderValue === null;
      toast({
        title: following ? 'Following the map default' : 'Your bookmark labels saved',
        tone: 'success',
      });
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

  return (
    <div className={styles.cards}>
      <Card>
        <CardHeader
          title="Map default"
          description={
            canManage
              ? 'The label everyone sees above a system: by default the signature of the wormhole that leads there. Click a label on the map to copy it.'
              : 'Managers choose the label everyone sees above a system.'
          }
        />
        <CardBody>
          <TemplatePicker
            label="Map default template"
            value={shared}
            onChange={setShared}
            disabled={!canManage}
          />
        </CardBody>
        {canManage && (
          <CardFooter>
            {mapDefault !== DEFAULT_BOOKMARK_TEMPLATE && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void saveMap(null)}>
                Reset to the signature
              </Button>
            )}
            <Button
              variant="primary"
              loading={busy === 'map'}
              disabled={shared === mapDefault || validate(shared) !== null || busy !== null}
              onClick={() => void saveMap(shared)}
            >
              Save for everyone
            </Button>
          </CardFooter>
        )}
      </Card>

      <BookmarkNumberingCard
        map={map}
        canManage={canManage}
        canEdit={canEdit}
        template={ownValue ?? shared}
      />

      <Card>
        <CardHeader
          title="Just for you"
          description="Your own template and numbering order win over the map's on every screen you use. A system's temporary name always shows instead."
        />
        <CardBody>
          <div className={styles.follow} role="radiogroup" aria-label="Your bookmark labels">
            <button
              type="button"
              role="radio"
              aria-checked={ownValue === null}
              className={styles.preset}
              disabled={!settled}
              onClick={() => {
                setOwn(null);
                setOwnTouched(true);
              }}
            >
              <span className={styles.tag}>{previewBookmark(mapDefault)[0]}</span>
              <span className={styles.optionText}>Use the map default</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={ownValue !== null}
              className={styles.preset}
              disabled={!settled}
              onClick={() => {
                setOwn(ownValue ?? mapDefault);
                setOwnTouched(true);
              }}
            >
              <span className={styles.optionTitle}>My own</span>
              <span className={styles.optionText}>Pick a template just for me</span>
            </button>
          </div>
          {ownValue !== null && (
            <TemplatePicker
              label="Your template"
              value={ownValue}
              onChange={(t) => {
                setOwn(t);
                setOwnTouched(true);
              }}
            />
          )}
          <div className={styles.ownOrder}>
            <span className={styles.customLabel}>Your numbering order</span>
            <OrderPicker
              label="Your numbering order"
              value={ownOrderValue}
              follow={mapOrder}
              disabled={!settled}
              onChange={(order) => {
                setOwnOrder(order);
                setOrderTouched(true);
              }}
            />
            {ownOrderValue !== null && ownOrderValue !== mapOrder && (
              <p className={styles.optionText} role="note">
                Counted on your screen only, so your numbers may not match what the rest of the fleet sees.
              </p>
            )}
          </div>
        </CardBody>
        <CardFooter>
          <Button
            variant="primary"
            loading={busy === 'own'}
            disabled={
              !(templateChanged || orderChanged) ||
              (templateChanged && ownValue !== null && validate(ownValue) !== null) ||
              busy !== null
            }
            onClick={() => void saveOwn()}
          >
            Save mine
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
