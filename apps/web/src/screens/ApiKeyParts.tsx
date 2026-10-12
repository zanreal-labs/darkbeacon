'use client';

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Bot, Copy, KeyRound, RefreshCw, Trash2, X } from 'lucide-react';
import {
  routes,
  type ApiKeyDto,
  type CreateApiKeyRequest,
  type CreatedApiKeyDto,
  type CreateServiceKeyRequest,
  type MapSummaryDto,
  type ScopeAction,
} from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import {
  useCreateApiKey,
  useCreateServiceKey,
  useRevokeApiKey,
  useRotateApiKey,
  type KeyScope,
} from '../lib/api-keys';
import {
  actionsFor,
  BUILDER_RESOURCES,
  describeGrants,
  describeScopes,
  draftProblem,
  draftScopes,
  emptyDraft,
  expiresAtFor,
  listWords,
  parseIpList,
  untilWords,
  type BuilderResource,
  type ExpiryChoice,
  type PresetId,
  type ScopeDraft,
} from '../lib/scope-builder';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Callout,
  ChoiceGroup,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  IconButton,
  Input,
  Row,
  Rows,
  SearchPicker,
  Select,
  Switch,
  Textarea,
  useToast,
  type PickerOption,
} from '../ui';
import styles from './apiKeys.module.css';
import settings from './settings.module.css';

/** The API reference, served by the API server (not a page of this app). */
export const API_DOCS_PATH = routes.docs.ui.path;

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** This site's origin in the browser; empty while rendering on the server. */
export function useOrigin(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );
}

/** Opens the API reference in a new tab. */
export function ApiDocsLink({ size }: { size?: 'sm' | 'md' }) {
  return (
    <Button asChild size={size} trailingIcon={<ArrowUpRight />}>
      <a href={API_DOCS_PATH} target="_blank" rel="noreferrer">
        API docs
      </a>
    </Button>
  );
}

/** A value to copy: a token, an address, a command. `extra` adds buttons next to Copy. */
export function CopyValue({
  label,
  value,
  copyLabel,
  copied,
  extra,
}: {
  label?: ReactNode;
  value: string;
  copyLabel: string;
  /** Toast title once copied. */
  copied: string;
  extra?: ReactNode;
}) {
  const toast = useToast();
  return (
    <div>
      {label && <div className={styles.copyLabel}>{label}</div>}
      <div className={styles.copy}>
        <code className="mono">{value}</code>
        <IconButton
          size="sm"
          label={copyLabel}
          icon={<Copy />}
          onClick={() =>
            void navigator.clipboard
              ?.writeText(value)
              .then(() => toast({ title: copied, tone: 'success' }))
              .catch(() => {})
          }
        />
        {extra}
      </div>
    </div>
  );
}

// ---- The token, once --------------------------------------------------------------------------

export interface ShownToken {
  name: string;
  token: string;
  rotated?: boolean;
}

export const shownToken = (created: CreatedApiKeyDto, rotated = false): ShownToken => ({
  name: created.key.name,
  token: created.token,
  rotated,
});

/** The new token with a ready-to-run example; closing it forgets the token for good. */
export function TokenDialog({ shown, onClose }: { shown: ShownToken | null; onClose(): void }) {
  const origin = useOrigin();
  return (
    <Dialog open={shown !== null} onOpenChange={(open) => !open && onClose()}>
      {shown && (
        <DialogContent
          title={shown.rotated ? `New token for ${shown.name}` : `${shown.name} is ready`}
          description={
            shown.rotated
              ? 'The old token stopped working. Put this one wherever the old one was.'
              : 'Send it as a bearer token with every request.'
          }
          width={560}
          footer={
            <>
              <ApiDocsLink />
              <DialogClose asChild>
                <Button variant="primary">I saved it</Button>
              </DialogClose>
            </>
          }
        >
          <div className={settings.formStack}>
            <Callout tone="warning" title="It will not be shown again">
              Copy it now and keep it like a password. If it gets lost, rotate the key for a new one.
            </Callout>
            <CopyValue label="Token" value={shown.token} copyLabel="Copy token" copied="Token copied" />
            <CopyValue
              label="Try it"
              value={`curl -H "Authorization: Bearer ${shown.token}" ${origin}/api/v1/maps`}
              copyLabel="Copy command"
              copied="Command copied"
            />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

// ---- Maps by name -----------------------------------------------------------------------------

const MAP_ROLE_WORD: Record<MapSummaryDto['role'], string> = {
  viewer: 'Viewer',
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
};

type MapOption = PickerOption & { map: MapSummaryDto };

/** Search the maps you can open by name; picking one hands it over and clears the search. */
export function MapPicker({
  maps,
  exclude,
  onPick,
  disabled,
}: {
  maps: readonly MapSummaryDto[];
  exclude: readonly string[];
  onPick(map: MapSummaryDto): void;
  disabled?: boolean;
}) {
  return (
    <SearchPicker<MapOption>
      value={null}
      onChange={(option) => option && onPick(option.map)}
      cacheKey={['key-maps', maps.map((m) => m.id).join(','), exclude.join(',')]}
      minLength={0}
      disabled={disabled}
      placeholder="Search your maps by name"
      empty="No other map matches"
      search={async (text) => {
        const q = text.toLowerCase();
        return {
          options: maps
            .filter((m) => !exclude.includes(m.id) && m.name.toLowerCase().includes(q))
            .map((m) => ({ key: m.id, label: m.name, detail: MAP_ROLE_WORD[m.role], map: m })),
        };
      }}
    />
  );
}

// ---- Scope builder ----------------------------------------------------------------------------

const ACTION_LABEL: Record<ScopeAction, string> = { read: 'Read', write: 'Change', manage: 'Manage' };
const NONE = 'none';

const RESOURCE_TEXT: Record<BuilderResource, { name: string; hint: string }> = {
  maps: { name: 'Maps', hint: 'Open maps; change labels; manage settings, sharing and deletion' },
  systems: { name: 'Systems', hint: 'See systems; add, move and edit them; manage locks' },
  connections: { name: 'Connections', hint: 'See connections with mass and time; edit them' },
  signatures: { name: 'Signatures', hint: 'See signatures; add, paste, edit and remove them' },
  routes: { name: 'Routes', hint: 'Routes, exits and hubs; change the map’s hubs' },
  tracking: { name: 'Tracking', hint: 'Tracked characters and where they are; track your own' },
  audit: { name: 'History', hint: 'What changed on the map; revert a change' },
  webhooks: { name: 'Webhooks', hint: 'The map’s webhooks' },
  access: { name: 'Access rules', hint: 'Who may open and edit the map' },
  account: { name: 'Account', hint: 'Profile and landing; main character, default map, hubs' },
  universe: { name: 'Game data', hint: 'Systems and wormhole types' },
  admin: { name: 'Instance administration', hint: 'Settings, people, plugins and themes' },
};

/**
 * What a key may do: a preset or a choice per kind of data, on every map or on maps picked by
 * name, with the result read back in words underneath.
 */
export function ScopeBuilder({
  draft,
  onChange,
  maps,
  allowAdmin,
  everyMap,
  disabled,
}: {
  draft: ScopeDraft;
  onChange(draft: ScopeDraft): void;
  maps: readonly MapSummaryDto[];
  /** Offer instance administration (instance admins, admin service keys). */
  allowAdmin: boolean;
  /** "all your maps" / "every map the key can reach". */
  everyMap: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<ScopeDraft>) => onChange({ ...draft, ...patch });
  const setAction = (resource: BuilderResource, value: string) => {
    const access = { ...draft.access };
    if (value === NONE) delete access[resource];
    else access[resource] = value as ScopeAction;
    set({ access });
  };
  const resources = BUILDER_RESOURCES.filter((r) => r !== 'admin' || allowAdmin);
  const picked = draft.mapIds.flatMap((id) => maps.find((m) => m.id === id) ?? []);
  const summary = describeScopes(
    draftScopes(allowAdmin ? draft : { ...draft, access: { ...draft.access, admin: undefined } }),
    maps,
    { everyMap },
  );

  return (
    <>
      <fieldset className={settings.fieldset} disabled={disabled}>
        <legend className={settings.legend}>What it may do</legend>
        <ChoiceGroup
          aria-label="Permissions preset"
          value={draft.preset}
          onValueChange={(preset) => set({ preset: preset as PresetId })}
          options={[
            {
              value: 'readAll',
              label: 'Read everything',
              description: 'Maps, the account and game data. Changes nothing.',
            },
            {
              value: 'mapper',
              label: 'Mapper',
              description: 'Read everything, and add and edit systems, connections and signatures.',
            },
            { value: 'custom', label: 'Custom', description: 'Choose for each kind of data.' },
          ]}
        />
        {draft.preset === 'custom' && (
          <ul className={styles.resources} aria-label="Permissions">
            {resources.map((r) => (
              <li key={r} className={styles.resource}>
                <div className={styles.resourceText}>
                  <span className={styles.resourceName}>{RESOURCE_TEXT[r].name}</span>
                  <span className={styles.resourceHint}>{RESOURCE_TEXT[r].hint}</span>
                </div>
                <div className={styles.resourceAction}>
                  <Select
                    size="sm"
                    aria-label={`${RESOURCE_TEXT[r].name} access`}
                    value={draft.access[r] ?? NONE}
                    options={[
                      { value: NONE, label: 'No access' },
                      ...actionsFor(r).map((a) => ({ value: a, label: ACTION_LABEL[a] })),
                    ]}
                    onValueChange={(value) => setAction(r, value)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className={settings.fieldset} disabled={disabled}>
        <legend className={settings.legend}>Which maps</legend>
        <ChoiceGroup
          aria-label="Which maps"
          value={draft.maps}
          onValueChange={(value) => set({ maps: value as ScopeDraft['maps'] })}
          options={[
            {
              value: 'all',
              label: everyMap.charAt(0).toUpperCase() + everyMap.slice(1),
              description: 'Maps added later count too.',
            },
            { value: 'picked', label: 'Only the maps I pick', description: 'Search them by name below.' },
          ]}
        />
        {draft.maps === 'picked' && (
          <>
            <Field label="Add a map" hint="Only maps you can open are listed.">
              <MapPicker
                maps={maps}
                exclude={draft.mapIds}
                disabled={disabled}
                onPick={(m) => set({ mapIds: [...draft.mapIds, m.id] })}
              />
            </Field>
            {picked.length > 0 && (
              <div className={settings.chips} aria-label="Picked maps">
                {picked.map((m) => (
                  <Badge key={m.id} variant="outline">
                    {m.name}
                    <button
                      type="button"
                      className={settings.chipRemove}
                      aria-label={`Remove ${m.name}`}
                      onClick={() => set({ mapIds: draft.mapIds.filter((id) => id !== m.id) })}
                    >
                      <X />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
      </fieldset>

      {summary.length > 0 && (
        <ul className={styles.summary} aria-label="What the key can do">
          <li className={styles.summaryTitle}>The key can</li>
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Rows -------------------------------------------------------------------------------------

const STATUS = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  revoked: { label: 'Revoked', tone: 'neutral' },
} as const;

/** Where a key stands in time: when it ends, or when it ended. */
function lifeText(k: ApiKeyDto): string {
  if (k.status === 'revoked') return k.revokedAt ? `Revoked ${relativeTime(k.revokedAt)}` : 'Revoked';
  if (k.status === 'expired') return k.expiresAt ? `Expired ${relativeTime(k.expiresAt)}` : 'Expired';
  return k.expiresAt ? `Expires ${untilWords(k.expiresAt)}` : 'Never expires';
}

function usageText(k: ApiKeyDto): string {
  if (!k.lastUsedAt) return 'Never used';
  return `Last used ${relativeTime(k.lastUsedAt)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}`;
}

function ownerText(k: ApiKeyDto): string {
  const name = k.createdBy.name;
  return k.kind === 'svc'
    ? `Service key, made by ${name ?? 'an admin'}`
    : `Belongs to ${name ?? 'an account'}`;
}

/** One key: name and state, what it may do in words, how long it lives and when it was used. */
export function KeyRow({
  apiKey: k,
  showOwner,
  everyMap,
  onRotate,
  onRevoke,
}: {
  apiKey: ApiKeyDto;
  showOwner?: boolean;
  everyMap: string;
  onRotate?: () => void;
  onRevoke?: () => void;
}) {
  const status = STATUS[k.status];
  const prefix = k.prefix.endsWith('…') ? k.prefix : `${k.prefix}…`;
  const grants = k.kind === 'svc' ? describeGrants(k) : [];
  const scopes = describeScopes(k.scopes, k.maps, { everyMap });
  const limits = [
    k.allowedIps.length === 0
      ? null
      : k.allowedIps.length <= 2
        ? `Only from ${listWords(k.allowedIps)}`
        : `Only from ${k.allowedIps.length} addresses`,
    k.rateLimitPerMinute ? `${k.rateLimitPerMinute} requests a minute` : null,
  ].filter(Boolean);
  return (
    <Row
      leading={
        <span className={styles.keyIcon} data-inactive={k.status !== 'active' || undefined} aria-hidden>
          {k.kind === 'svc' ? <Bot /> : <KeyRound />}
        </span>
      }
      title={
        <>
          <span>{k.name}</span>
          <Badge tone={status.tone} dot={k.status === 'active'}>
            {status.label}
          </Badge>
          {k.readOnly && <Badge variant="outline">Read only</Badge>}
        </>
      }
      meta={
        <span className={styles.metaLines}>
          <span className={styles.metaLine}>
            <span className={styles.prefix}>{prefix}</span>
            {showOwner && ` · ${ownerText(k)}`}
          </span>
          {grants.length > 0 && <span className={styles.metaLine}>{grants.join(' · ')}</span>}
          {scopes.length > 0 && <span className={styles.metaLine}>{scopes.join(' · ')}</span>}
          <span className={styles.metaLine}>{[lifeText(k), usageText(k), ...limits].join(' · ')}</span>
        </span>
      }
      actions={
        <div className={styles.actions}>
          {onRotate && k.status === 'active' && (
            <IconButton size="sm" label={`Rotate ${k.name}`} icon={<RefreshCw />} onClick={onRotate} />
          )}
          {onRevoke && k.status !== 'revoked' && (
            <IconButton size="sm" label={`Revoke ${k.name}`} icon={<Trash2 />} onClick={onRevoke} />
          )}
        </div>
      }
    />
  );
}

const ORDER = { active: 0, expired: 1, revoked: 2 } as const;

/** Active keys first, newest first within each state. */
export const sortKeys = (keys: readonly ApiKeyDto[]) =>
  [...keys].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt - a.createdAt);

/**
 * Keys as rows with rotate and revoke, each behind a confirmation; a rotated token shows once.
 * `scope`: the account's own keys, or any key as an instance admin.
 */
export function KeyList({
  keys,
  scope,
  showOwner,
  everyMap,
  canRotate,
}: {
  keys: readonly ApiKeyDto[];
  scope: KeyScope;
  showOwner?: boolean;
  everyMap: string;
  canRotate(key: ApiKeyDto): boolean;
}) {
  const toast = useToast();
  const rotate = useRotateApiKey();
  const revoke = useRevokeApiKey(scope);
  const [rotating, setRotating] = useState<ApiKeyDto | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);
  const [shown, setShown] = useState<ShownToken | null>(null);
  return (
    <>
      <Rows>
        {sortKeys(keys).map((k) => (
          <KeyRow
            key={k.id}
            apiKey={k}
            showOwner={showOwner}
            everyMap={everyMap}
            onRotate={canRotate(k) ? () => setRotating(k) : undefined}
            onRevoke={() => setRevoking(k)}
          />
        ))}
      </Rows>
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => !open && setRotating(null)}
        title={`Rotate ${rotating?.name ?? 'this key'}?`}
        description="You get a new token now and the old one stops working at once. Everything that uses it needs the new one."
        confirmLabel="Rotate key"
        onConfirm={() =>
          rotating &&
          rotate
            .mutateAsync(rotating)
            .then((created) => setShown(shownToken(created, true)))
            .catch((error: unknown) =>
              toast({
                title: 'Could not rotate',
                description: errorText(error, 'Try again.'),
                tone: 'danger',
              }),
            )
        }
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? 'this key'}?`}
        description={
          revoking?.kind === 'svc'
            ? 'Every integration that uses this service key stops working at once. This cannot be undone.'
            : showOwner
              ? `Scripts and tools of ${revoking?.createdBy.name ?? 'its owner'} that use it stop working at once. This cannot be undone.`
              : 'Scripts and tools that use it stop working at once. This cannot be undone.'
        }
        confirmLabel="Revoke key"
        tone="danger"
        onConfirm={() =>
          revoking &&
          revoke
            .mutateAsync(revoking)
            .then(() => toast({ title: `${revoking.name} revoked`, tone: 'success' }))
            .catch((error: unknown) =>
              toast({
                title: 'Could not revoke',
                description: errorText(error, 'Try again.'),
                tone: 'danger',
              }),
            )
        }
      />
      <TokenDialog shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

// ---- New key ----------------------------------------------------------------------------------

type GrantRole = 'viewer' | 'member' | 'manager' | 'admin';

interface KeyForm {
  name: string;
  draft: ScopeDraft;
  readOnly: boolean;
  expiry: ExpiryChoice;
  date: string;
  ips: string;
  rate: string;
  // Service keys only.
  instanceRole: 'user' | 'admin';
  allMapsRole: GrantRole | typeof NONE;
  grants: { mapId: string; role: GrantRole }[];
}

const emptyForm = (): KeyForm => ({
  name: '',
  draft: emptyDraft(),
  readOnly: false,
  expiry: '90',
  date: '',
  ips: '',
  rate: '',
  instanceRole: 'user',
  allMapsRole: NONE,
  grants: [],
});

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'member', label: 'Member' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

/** `YYYY-MM-DD` of the local day, as date inputs take it. */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Checked {
  errors: Partial<Record<'name' | 'scopes' | 'date' | 'ips' | 'rate', string>>;
  body: CreateServiceKeyRequest | null;
}

/** Turns the form into a request, or says what is missing. */
function check(form: KeyForm, kind: 'pat' | 'svc', allowAdmin: boolean, now: number): Checked {
  const errors: Checked['errors'] = {};
  const draft = allowAdmin
    ? form.draft
    : { ...form.draft, access: { ...form.draft.access, admin: undefined } };
  if (!form.name.trim()) errors.name = 'Give the key a name you will recognise.';
  const problem = draftProblem(draft);
  if (problem) errors.scopes = problem;
  const expiresAt = expiresAtFor(form.expiry, form.date, now);
  if (form.expiry === 'date' && (expiresAt === null || expiresAt <= now))
    errors.date = 'Pick a day after today.';
  const { ips, invalid } = parseIpList(form.ips);
  if (invalid.length > 0) errors.ips = `Not an IP address or range: ${listWords(invalid)}.`;
  else if (ips.length > 20) errors.ips = 'At most 20 addresses or ranges.';
  const rate = form.rate.trim() === '' ? null : Number(form.rate);
  if (rate !== null && (!Number.isInteger(rate) || rate < 1 || rate > 10_000))
    errors.rate = 'A whole number from 1 to 10000.';
  if (Object.keys(errors).length > 0) return { errors, body: null };
  const body: CreateApiKeyRequest = {
    name: form.name.trim(),
    scopes: draftScopes(draft),
    readOnly: form.readOnly,
    expiresAt,
    allowedIps: ips,
    rateLimitPerMinute: rate,
  };
  return {
    errors,
    body:
      kind === 'svc'
        ? {
            ...body,
            instanceRole: form.instanceRole,
            mapGrants: form.grants,
            allMapsRole: form.allMapsRole === NONE ? null : form.allMapsRole,
          }
        : { ...body, instanceRole: 'user', mapGrants: [], allMapsRole: null },
  };
}

/**
 * The new key form: a name, what it may do and where, read-only, expiry, IP allow-list and rate
 * limit; service keys also get their instance role and map roles. `onCreated` gets the token.
 */
export function NewKeyDialog({
  open,
  onOpenChange,
  kind,
  maps,
  isAdmin,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  kind: 'pat' | 'svc';
  /** The maps the signed-in account can open (pickers list these by name). */
  maps: readonly MapSummaryDto[];
  /** The signed-in account is an instance admin (personal keys may then administer). */
  isAdmin: boolean;
  onCreated(created: CreatedApiKeyDto): void;
}) {
  const [form, setForm] = useState<KeyForm>(emptyForm);
  const [tried, setTried] = useState(false);
  const createPersonal = useCreateApiKey();
  const createService = useCreateServiceKey();
  const create = kind === 'svc' ? createService : createPersonal;
  const set = (patch: Partial<KeyForm>) => setForm((f) => ({ ...f, ...patch }));
  const allowAdmin = kind === 'svc' ? form.instanceRole === 'admin' : isAdmin;
  const everyMap = kind === 'svc' ? 'every map the key can reach' : 'all your maps';
  const [now] = useState(() => Date.now());
  const shownErrors = tried ? check(form, kind, allowAdmin, now).errors : {};
  const today = localDate(now);

  const change = (next: boolean) => {
    if (!next) {
      setForm(emptyForm());
      setTried(false);
      createPersonal.reset();
      createService.reset();
    }
    onOpenChange(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    const { body } = check(form, kind, allowAdmin, Date.now());
    if (!body) return;
    const done = (created: CreatedApiKeyDto) => {
      onCreated(created);
      change(false);
    };
    if (kind === 'svc') createService.mutate(body, { onSuccess: done });
    else {
      const { name, scopes, readOnly, expiresAt, allowedIps, rateLimitPerMinute } = body;
      createPersonal.mutate(
        { name, scopes, readOnly, expiresAt, allowedIps, rateLimitPerMinute },
        { onSuccess: done },
      );
    }
  };
  const granted = form.grants.flatMap((g) => {
    const map = maps.find((m) => m.id === g.mapId);
    return map ? [{ ...g, map }] : [];
  });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        title={kind === 'svc' ? 'New service key' : 'New API key'}
        description={
          kind === 'svc'
            ? 'For a bot or an integration that acts as itself, with the roles you give it here.'
            : 'It acts as you, and never does more than you can yourself.'
        }
        width={640}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="submit" form={`new-key-${kind}`} variant="primary" loading={create.isPending}>
              {kind === 'svc' ? 'Make service key' : 'Make key'}
            </Button>
          </>
        }
      >
        <form id={`new-key-${kind}`} onSubmit={submit} className={settings.formStack} noValidate>
          <Field
            label="Name"
            hint="Where it is used, e.g. Discord bot or Spreadsheet."
            error={shownErrors.name}
          >
            <Input
              autoFocus
              maxLength={64}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={kind === 'svc' ? 'Alliance bot' : 'My script'}
            />
          </Field>

          {kind === 'svc' && (
            <fieldset className={settings.fieldset}>
              <legend className={settings.legend}>Its roles</legend>
              <div className={styles.inlineFields}>
                <Field label="On this instance">
                  <Select
                    value={form.instanceRole}
                    options={[
                      { value: 'user', label: 'User' },
                      { value: 'admin', label: 'Admin' },
                    ]}
                    onValueChange={(v) => set({ instanceRole: v as KeyForm['instanceRole'] })}
                  />
                </Field>
                <Field label="On every map">
                  <Select
                    value={form.allMapsRole}
                    options={[{ value: NONE, label: 'Only the maps below' }, ...ROLE_OPTIONS]}
                    onValueChange={(v) => set({ allMapsRole: v as KeyForm['allMapsRole'] })}
                  />
                </Field>
              </div>
              <Field label="Add a map" hint="Only maps you can open are listed.">
                <MapPicker
                  maps={maps}
                  exclude={form.grants.map((g) => g.mapId)}
                  onPick={(m) => set({ grants: [...form.grants, { mapId: m.id, role: 'viewer' }] })}
                />
              </Field>
              {granted.length > 0 && (
                <ul className={styles.grants} aria-label="Map roles">
                  {granted.map((g) => (
                    <li key={g.mapId} className={styles.grant}>
                      <span className={styles.grantName}>{g.map.name}</span>
                      <div className={styles.grantRole}>
                        <Select
                          size="sm"
                          aria-label={`Role on ${g.map.name}`}
                          value={g.role}
                          options={ROLE_OPTIONS}
                          onValueChange={(role) =>
                            set({
                              grants: form.grants.map((x) =>
                                x.mapId === g.mapId ? { ...x, role: role as GrantRole } : x,
                              ),
                            })
                          }
                        />
                      </div>
                      <IconButton
                        size="sm"
                        label={`Remove ${g.map.name}`}
                        icon={<X />}
                        onClick={() => set({ grants: form.grants.filter((x) => x.mapId !== g.mapId) })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          <ScopeBuilder
            draft={form.draft}
            onChange={(draft) => set({ draft })}
            maps={maps}
            allowAdmin={allowAdmin}
            everyMap={everyMap}
          />
          {shownErrors.scopes && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {shownErrors.scopes}
            </p>
          )}

          <Switch
            checked={form.readOnly}
            onCheckedChange={(readOnly) => set({ readOnly })}
            label="Read only"
            description="Only reads, whatever the permissions above allow."
          />

          <div className={styles.inlineFields}>
            <Field label="Expires">
              <Select
                value={form.expiry}
                options={[
                  { value: '7', label: 'In 7 days' },
                  { value: '30', label: 'In 30 days' },
                  { value: '90', label: 'In 90 days' },
                  { value: 'date', label: 'On a day I pick' },
                  { value: 'never', label: 'Never' },
                ]}
                onValueChange={(v) => set({ expiry: v as ExpiryChoice })}
              />
            </Field>
            {form.expiry === 'date' && (
              <Field label="Last day" error={shownErrors.date}>
                <Input
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
              </Field>
            )}
            <Field
              label="Requests a minute"
              optional
              hint="Empty: the instance default."
              error={shownErrors.rate}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={10_000}
                value={form.rate}
                onChange={(e) => set({ rate: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Allowed addresses"
            optional
            hint="IP addresses or ranges such as 203.0.113.0/24, one per line. Empty: from anywhere."
            error={shownErrors.ips}
          >
            <Textarea
              mono
              rows={3}
              value={form.ips}
              onChange={(e) => set({ ips: e.target.value })}
              spellCheck={false}
            />
          </Field>

          {create.error && (
            <Callout tone="danger" title="The key was not made">
              {errorText(create.error, 'Something went wrong. Try again.')}
            </Callout>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
