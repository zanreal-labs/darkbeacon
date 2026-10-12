'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, DoorOpen, Link2, Lock, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import {
  buildPath,
  routes,
  type CreatedInviteDto,
  type CreateInviteRequest,
  type InviteDto,
  type SignInPolicy,
} from '@darkbeacon/shared';
import { EvePicker, GuildSelect, useDiscordGuilds } from '../components/pickers';
import { api, ApiError } from '../lib/api';
import { useInstance } from '../lib/maps';
import { untilWords } from '../lib/scope-builder';
import { useProviders } from '../lib/session';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChoiceGroup,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  SkeletonRows,
  Switch,
  useToast,
} from '../ui';
import { useEveNames } from './AdminCharacters';
import { useInstanceSettings, useSaveSettings } from './AdminPage';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const OPEN: SignInPolicy = { mode: 'open', corporationIds: [], allianceIds: [], guildIds: [] };

// ---- Who may sign up ----------------------------------------------------------------------------

/** Who may get a new account; with invite links while it is restricted. */
export function SignUpCard() {
  const settings = useInstanceSettings();
  const providers = useProviders();
  const save = useSaveSettings('Sign-up saved');
  const [draft, setDraft] = useState<SignInPolicy | null>(null);
  const saved = settings.data?.signIn ?? OPEN;
  const value = draft ?? saved;
  const names = useEveNames([...value.corporationIds, ...value.allianceIds]);
  const discord = providers.data?.discord ?? false;
  const set = (patch: Partial<SignInPolicy>) => setDraft({ ...value, ...patch });
  const add = (list: 'corporationIds' | 'allianceIds', id: number) =>
    !value[list].includes(id) && set({ [list]: [...value[list], id] });

  return (
    <>
      <Card>
        <CardHeader
          title="Who may sign up"
          description="Decides who gets a new account on first sign-in. People who already have an account always sign in; to keep someone out, disable them under People."
        />
        <CardBody>
          <div className={styles.formStack}>
            <ChoiceGroup
              aria-label="Who may sign up"
              value={settings.data ? value.mode : undefined}
              disabled={!settings.data || save.isPending}
              onValueChange={(mode) => set({ mode: mode as SignInPolicy['mode'] })}
              options={[
                {
                  value: 'open',
                  label: 'Anyone',
                  icon: <DoorOpen />,
                  description: 'Everyone who signs in gets an account.',
                },
                {
                  value: 'restricted',
                  label: 'Only people you allow',
                  icon: <Lock />,
                  description:
                    'Members of the corporations, alliances and Discord servers below, and people with an invite link.',
                },
              ]}
            />
            {value.mode === 'restricted' && (
              <>
                <IdList
                  legend="Corporations"
                  label="Add a corporation"
                  hint="Checked against the character people sign in with."
                  ids={value.corporationIds}
                  name={(id) => names.name(id) ?? (names.isPending ? '…' : `Corporation ${id}`)}
                  onRemove={(id) => set({ corporationIds: value.corporationIds.filter((x) => x !== id) })}
                >
                  <EvePicker
                    category="corporation"
                    value={null}
                    onChange={(o) => o && add('corporationIds', o.entity.id)}
                  />
                </IdList>
                <IdList
                  legend="Alliances"
                  label="Add an alliance"
                  hint="Checked against the character people sign in with."
                  ids={value.allianceIds}
                  name={(id) => names.name(id) ?? (names.isPending ? '…' : `Alliance ${id}`)}
                  onRemove={(id) => set({ allianceIds: value.allianceIds.filter((x) => x !== id) })}
                >
                  <EvePicker
                    category="alliance"
                    value={null}
                    onChange={(o) => o && add('allianceIds', o.entity.id)}
                  />
                </IdList>
                {(discord || value.guildIds.length > 0) && (
                  <GuildList ids={value.guildIds} onChange={(guildIds) => set({ guildIds })} />
                )}
              </>
            )}
          </div>
        </CardBody>
        <CardFooter>
          {draft && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!draft}
            onClick={() => draft && save.mutate({ signIn: draft }, { onSuccess: () => setDraft(null) })}
          >
            Save
          </Button>
        </CardFooter>
      </Card>
      {value.mode === 'restricted' && <InvitesCard />}
    </>
  );
}

/** Allowed corporations or alliances, by name, with a picker to add one. */
function IdList({
  legend,
  label,
  hint,
  ids,
  name,
  onRemove,
  children,
}: {
  legend: string;
  label: string;
  hint: string;
  ids: number[];
  name(id: number): string;
  onRemove(id: number): void;
  children: ReactNode;
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      <Field label={label} hint={hint}>
        {children}
      </Field>
      {ids.length > 0 && (
        <div className={styles.chips} aria-label={`Allowed ${legend.toLowerCase()}`}>
          {ids.map((id) => (
            <Badge key={id} variant="outline">
              {name(id)}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${name(id)}`}
                onClick={() => onRemove(id)}
              >
                <X />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Allowed Discord servers: picked from the bot's list, or typed as an id without a bot. */
function GuildList({ ids, onChange }: { ids: string[]; onChange(ids: string[]): void }) {
  const bot = useInstance().data?.discordBot ?? false;
  const guilds = useDiscordGuilds(bot);
  const [typed, setTyped] = useState('');
  const valid = /^\d{1,20}$/.test(typed.trim());
  const add = (id: string) => !ids.includes(id) && onChange([...ids, id]);
  const name = (id: string) => guilds.data?.find((g) => g.id === id)?.name ?? `Server ${id}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    add(typed.trim());
    setTyped('');
  };
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Discord servers</legend>
      {bot ? (
        <Field label="Add a server" hint="Checked when people sign in with Discord.">
          <GuildSelect value={null} onChange={add} />
        </Field>
      ) : (
        <form className={styles.inline} onSubmit={submit} aria-label="Add a Discord server">
          <Field
            label="Server id"
            hint="Checked when people sign in with Discord. Connect a Discord bot below to pick servers by name."
          >
            <Input
              mono
              inputMode="numeric"
              placeholder="123456789012345678"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <Button type="submit" icon={<Plus />} disabled={!valid}>
            Add
          </Button>
        </form>
      )}
      {ids.length > 0 && (
        <div className={styles.chips} aria-label="Allowed Discord servers">
          {ids.map((id) => (
            <Badge key={id} variant="outline">
              {name(id)}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${name(id)}`}
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                <X />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </fieldset>
  );
}

// ---- Invite links -------------------------------------------------------------------------------

const invitesKey = ['admin-invites'] as const;

const EXPIRY_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'never', label: 'Never' },
];
const USES_OPTIONS = [
  { value: '1', label: 'Once' },
  { value: '5', label: '5 people' },
  { value: '25', label: '25 people' },
  { value: 'any', label: 'Any number' },
];

function inviteState(i: InviteDto, now: number): { label: string; tone: 'success' | 'neutral' } {
  if (i.revokedAt !== null) return { label: 'Revoked', tone: 'neutral' };
  if (i.active) return { label: 'Active', tone: 'success' };
  if (i.expiresAt !== null && i.expiresAt <= now) return { label: 'Expired', tone: 'neutral' };
  return { label: 'Used up', tone: 'neutral' };
}

function InvitesCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<InviteDto | null>(null);
  const invites = useQuery({
    queryKey: invitesKey,
    queryFn: () => api<InviteDto[]>(routes.adminIdentity.invites.path),
  });
  // Expiry is told as of the last fetch, so rendering stays pure.
  const now = invites.dataUpdatedAt;
  const revoke = useMutation({
    mutationFn: (i: InviteDto) =>
      api<void>(buildPath(routes.adminIdentity.revokeInvite.path, { inviteId: i.id }), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitesKey });
      toast({ title: 'Invite revoked', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not revoke', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const label = (i: InviteDto) => i.note || 'Invite link';

  return (
    <Card>
      <CardHeader
        title="Invite links"
        description="Anyone holding a link may sign up while sign-up is limited. Each link is shown once, when you make it."
        actions={
          <Button icon={<Plus />} onClick={() => setCreating(true)}>
            New invite
          </Button>
        }
      />
      <CardBody flush>
        {invites.isPending ? (
          <SkeletonRows count={2} avatar={false} />
        ) : invites.isError ? (
          <ErrorState compact error={invites.error} onRetry={() => void invites.refetch()} />
        ) : invites.data.length === 0 ? (
          <EmptyState
            compact
            icon={<Link2 />}
            title="No invites yet"
            description="Make one for someone who is not in an allowed corporation, alliance or server."
          />
        ) : (
          <ul className={styles.list} aria-label="Invites">
            {invites.data.map((i) => {
              const state = inviteState(i, now);
              return (
                <li key={i.id} className={`${styles.item} ${styles.itemCenter}`}>
                  <span className={styles.subjectIcon} aria-hidden>
                    <Link2 />
                  </span>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {label(i)}
                      <Badge tone={state.tone} dot={state.tone === 'success'}>
                        {state.label}
                      </Badge>
                    </div>
                    <div className={styles.rowMeta}>
                      {i.maxUses === null ? `Used ${i.uses} times` : `Used ${i.uses} of ${i.maxUses}`}
                      {i.revokedAt === null &&
                        (i.expiresAt === null
                          ? ' · never expires'
                          : i.expiresAt > now
                            ? ` · expires ${untilWords(i.expiresAt, now)}`
                            : ` · expired ${relativeTime(i.expiresAt, now)}`)}
                      {` · made ${relativeTime(i.createdAt)}`}
                    </div>
                  </div>
                  {i.active && (
                    <div className={styles.rowActions}>
                      <IconButton
                        size="sm"
                        label={`Revoke ${label(i)}`}
                        icon={<Trash2 />}
                        onClick={() => setRevoking(i)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <NewInviteDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this invite?"
        description="The link stops working at once. Accounts made with it stay."
        confirmLabel="Revoke invite"
        tone="danger"
        onConfirm={() => revoking && revoke.mutateAsync(revoking)}
      />
    </Card>
  );
}

function NewInviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState('7');
  const [uses, setUses] = useState('1');
  const create = useMutation({
    mutationFn: (body: CreateInviteRequest) =>
      api<CreatedInviteDto>(routes.adminIdentity.createInvite.path, { method: 'POST', json: body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: invitesKey }),
  });
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setNote('');
      setExpiry('7');
      setUses('1');
      create.reset();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      note: note.trim() || null,
      expiresInDays: expiry === 'never' ? null : Number(expiry),
      maxUses: uses === 'any' ? null : Number(uses),
    });
  };
  const created = create.data;

  return (
    <Dialog open={open} onOpenChange={close}>
      {created ? (
        <DialogContent
          title="Your invite link"
          description="Send it to the people you invite. It will not be shown again."
          width={480}
          footer={
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          }
        >
          <CopyValue value={created.url} />
        </DialogContent>
      ) : (
        <DialogContent
          title="New invite"
          description="A link that lets people sign up while sign-up is limited."
          width={480}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
                Make link
              </Button>
            </>
          }
        >
          <form id={formId} className={styles.formStack} onSubmit={submit}>
            <Field
              label="Note"
              optional
              hint="Who it is for, so you recognise it in the list."
              error={create.error ? errorText(create.error, 'Could not make the invite.') : undefined}
            >
              <Input maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className={styles.grid}>
              <Field label="Expires after">
                <Select value={expiry} options={EXPIRY_OPTIONS} onValueChange={setExpiry} />
              </Field>
              <Field label="Can be used">
                <Select value={uses} options={USES_OPTIONS} onValueChange={setUses} />
              </Field>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function CopyValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className={styles.secret}>
      <code className="mono">{value}</code>
      <IconButton
        size="sm"
        label="Copy link"
        icon={<Copy />}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast({ title: 'Link copied', tone: 'success' }))
            .catch(() => {})
        }
      />
    </div>
  );
}

// ---- Who may create maps ------------------------------------------------------------------------

export function MapCreationCard() {
  const settings = useInstanceSettings();
  const save = useSaveSettings('Map creation saved');
  return (
    <Card>
      <CardHeader
        title="Who may create maps"
        description="Everyone keeps using the maps they have access to."
      />
      <CardBody>
        <ChoiceGroup
          aria-label="Who may create maps"
          value={settings.data ? (settings.data.mapCreation ?? 'everyone') : undefined}
          disabled={!settings.data || save.isPending}
          onValueChange={(mapCreation) => save.mutate({ mapCreation: mapCreation as 'everyone' | 'admins' })}
          options={[
            {
              value: 'everyone',
              label: 'Everyone',
              icon: <Users />,
              description: 'Anyone signed in can create a map and owns it.',
            },
            {
              value: 'admins',
              label: 'Only admins',
              icon: <ShieldCheck />,
              description: 'Instance admins create maps and hand them over to their owners.',
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

// ---- API and webhooks ---------------------------------------------------------------------------

export function ApiSwitchesCard() {
  const settings = useInstanceSettings();
  const save = useSaveSettings();
  return (
    <Card>
      <CardHeader
        title="API and webhooks"
        description="Switch off all outside access at once, for example during an incident."
      />
      <CardBody>
        <div className={styles.formStack}>
          <Switch
            checked={settings.data?.apiAccess ?? true}
            disabled={!settings.data || save.isPending}
            onCheckedChange={(on) => save.mutate({ apiAccess: on })}
            label="API keys and AI agents (MCP)"
            description="When off, API keys and tokens of connected apps are refused and AI agents cannot connect. People signed in with a browser keep working."
          />
          <Switch
            checked={settings.data?.webhooksEnabled ?? true}
            disabled={!settings.data || save.isPending}
            onCheckedChange={(on) => save.mutate({ webhooksEnabled: on })}
            label="Webhooks"
            description="When off, no map sends webhooks. Their settings stay, and events from that time are not sent later."
          />
        </div>
      </CardBody>
    </Card>
  );
}
