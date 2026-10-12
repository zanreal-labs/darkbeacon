'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, Flag, Hash, KeyRound, Lock, Plus, Trash2, UserRound } from 'lucide-react';
import {
  AccessSubjectKind,
  buildPath,
  MANAGER_ASSIGNABLE_ROLES,
  MapRole,
  routes,
  type AccessRuleDto,
  type CopyAccessRulesResultDto,
  type CreateAccessRuleRequest,
  type MapDto,
  type UpdateMapRequest,
} from '@darkbeacon/shared';
import {
  AccountPicker,
  BotHint,
  EvePicker,
  GuildSelect,
  RoleSelect,
  type AccountOption,
  type EveOption,
} from '../components/pickers';
import { api, ApiError } from '../lib/api';
import { useInstance, useMaps } from '../lib/maps';
import type { MapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Select,
  SkeletonRows,
  Stack,
  Switch,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const SUBJECT: Record<AccessSubjectKind, { label: string; icon: ReactNode; unknown: string }> = {
  corporation: { label: 'Corporation', icon: <Building2 />, unknown: 'A corporation ESI does not know' },
  alliance: { label: 'Alliance', icon: <Flag />, unknown: 'An alliance ESI does not know' },
  character: { label: 'Character', icon: <UserRound />, unknown: 'A character ESI does not know' },
  discordRole: { label: 'Discord role', icon: <Hash />, unknown: 'A Discord role the bot cannot see' },
  account: { label: 'Person', icon: <KeyRound />, unknown: 'An account that was removed' },
};

export const ROLE_LABEL: Record<MapRole, string> = {
  viewer: 'Viewer',
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
  blocked: 'Blocked',
};

const ROLE_HINT: Record<MapRole, string> = {
  viewer: 'Sees the map',
  member: 'Maps systems and signatures',
  manager: 'Also locks systems, edits labels and tags, and lets people in as viewer or member',
  admin: 'Also settings, access and notifications',
  blocked: 'Refused (see how blocks work above)',
};

type Subject =
  | { kind: 'character' | 'corporation' | 'alliance'; picked: EveOption | null }
  | { kind: 'account'; picked: AccountOption | null }
  | { kind: 'discordRole'; guildId: string | null; roleId: string | null };

function emptySubject(kind: AccessSubjectKind): Subject {
  if (kind === 'account') return { kind, picked: null };
  if (kind === 'discordRole') return { kind, guildId: null, roleId: null };
  return { kind, picked: null };
}

function subjectRequest(
  subject: Subject,
): Pick<CreateAccessRuleRequest, 'subjectKind' | 'subjectId' | 'guildId'> | null {
  switch (subject.kind) {
    case 'account':
      return subject.picked
        ? { subjectKind: 'account', subjectId: subject.picked.account.id, guildId: null }
        : null;
    case 'discordRole':
      return subject.guildId && subject.roleId
        ? { subjectKind: 'discordRole', subjectId: subject.roleId, guildId: subject.guildId }
        : null;
    default:
      return subject.picked
        ? { subjectKind: subject.kind, subjectId: String(subject.picked.entity.id), guildId: null }
        : null;
  }
}

const assignable = (role: MapRole) => (MANAGER_ASSIGNABLE_ROLES as readonly MapRole[]).includes(role);

/**
 * The Access section of the map settings: who can open the map and as what. Admins manage every
 * rule; managers, as in Wanderer, let people in as viewer or member and block them, but cannot
 * touch admins and managers. Roles change in place. Admins also copy rules from another map and
 * set who may open the map at all (tracked characters only, offline characters).
 */
export function MapAccessSection({ map, can }: { map: MapDto; can: MapPermissions }) {
  return (
    <Stack>
      <RulesCard map={map} can={can} />
      <AddRuleCard map={map} can={can} />
      {can.admin && <CopyRulesCard map={map} />}
      {can.admin && <OpeningCard map={map} />}
    </Stack>
  );
}

const rulesKey = (mapId: string) => ['access-rules', mapId];

function RulesCard({ map, can }: { map: MapDto; can: MapPermissions }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const instance = useInstance();
  const key = rulesKey(map.id);
  const rules = useQuery({
    queryKey: key,
    queryFn: () => api<AccessRuleDto[]>(buildPath(routes.access.list.path, { mapId: map.id })),
  });
  const [removing, setRemoving] = useState<AccessRuleDto | null>(null);
  const change = useMutation({
    mutationFn: ({ ruleId, role }: { ruleId: string; role: MapRole }) =>
      api<AccessRuleDto>(buildPath(routes.accessRules.update.path, { mapId: map.id, ruleId }), {
        method: 'PATCH',
        json: { role },
      }),
    onMutate: ({ ruleId, role }) => {
      const before = queryClient.getQueryData<AccessRuleDto[]>(key);
      if (before)
        queryClient.setQueryData(
          key,
          before.map((r) => (r.id === ruleId ? { ...r, role } : r)),
        );
      return { before };
    },
    onError: (error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
      toast({
        title: 'Could not change the role',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      });
    },
    onSuccess: (rule) =>
      toast({
        title: `${rule.subject?.name ?? 'Rule'} is now ${ROLE_LABEL[rule.role].toLowerCase()}`,
        tone: 'success',
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      api<void>(buildPath(routes.access.remove.path, { mapId: map.id, ruleId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) =>
      toast({
        title: 'Could not remove the rule',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });
  const discordRoles = instance.data?.discordRoles ?? false;
  const roleOptions = (current: MapRole) =>
    MapRole.options
      .filter((r) => can.admin || assignable(r) || r === current)
      .map((r) => ({ value: r, label: ROLE_LABEL[r], disabled: !can.admin && !assignable(r) }));

  return (
    <Card>
      <CardHeader
        title="Who can open this map"
        description="The highest matching rule wins. A block on a character or person refuses them whatever else matches; a block on a corporation, alliance or Discord role beats every rule on a group, and only a rule on a character or person gets past it."
      />
      <CardBody flush>
        {rules.isPending ? (
          <SkeletonRows count={2} />
        ) : rules.isError ? (
          <ErrorState compact error={rules.error} onRetry={() => void rules.refetch()} />
        ) : rules.data.length === 0 ? (
          <EmptyState
            compact
            icon={<Lock />}
            title="Only the owner can see this map"
            description={
              discordRoles
                ? 'Add a rule below to let your corporation, alliance or a Discord role in.'
                : 'Add a rule below to let your corporation, your alliance or a pilot in.'
            }
          />
        ) : (
          <ul className={styles.list} aria-label="Access rules">
            {rules.data.map((r) => {
              const name = r.subject?.name ?? SUBJECT[r.subjectKind].label.toLowerCase();
              const editable = can.admin || assignable(r.role);
              return (
                <li key={r.id} className={`${styles.item} ${styles.itemCenter}`}>
                  {r.subject?.imageUrl ? (
                    <Avatar
                      src={r.subject.imageUrl}
                      name={r.subject.name}
                      size={32}
                      shape={
                        r.subjectKind === 'character' || r.subjectKind === 'account' ? 'circle' : 'rounded'
                      }
                    />
                  ) : (
                    <span className={styles.subjectIcon} aria-hidden>
                      {SUBJECT[r.subjectKind].icon}
                    </span>
                  )}
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitle}>
                      {r.subject?.name ?? <span className="muted">{SUBJECT[r.subjectKind].unknown}</span>}
                      {r.subject?.detail && <span className={styles.version}>{r.subject.detail}</span>}
                    </div>
                    <div className={styles.rowMeta}>{SUBJECT[r.subjectKind].label}</div>
                  </div>
                  <div className={styles.rowActions}>
                    {editable ? (
                      <Select
                        size="sm"
                        aria-label={`Role of ${name}`}
                        value={r.role}
                        options={roleOptions(r.role)}
                        disabled={change.isPending && change.variables?.ruleId === r.id}
                        onValueChange={(role) => change.mutate({ ruleId: r.id, role: role as MapRole })}
                      />
                    ) : (
                      <Badge tone="accent" title="Only admins change admins and managers">
                        {ROLE_LABEL[r.role]}
                      </Badge>
                    )}
                    {editable ? (
                      <IconButton
                        size="sm"
                        label={`Remove the rule for ${name}`}
                        icon={<Trash2 />}
                        onClick={() => setRemoving(r)}
                      />
                    ) : (
                      <span style={{ width: 26 }} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove the rule for ${removing?.subject?.name ?? 'them'}?`}
        description="People who got in only through it lose access at once."
        confirmLabel="Remove rule"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing.id)}
      />
    </Card>
  );
}

function AddRuleCard({ map, can }: { map: MapDto; can: MapPermissions }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const instance = useInstance();
  const discordRoles = instance.data?.discordRoles ?? false;
  const bot = instance.data?.discordBot ?? false;
  const kinds = AccessSubjectKind.options.filter((k) => k !== 'discordRole' || discordRoles);
  const [subject, setSubject] = useState<Subject>(emptySubject('corporation'));
  const [role, setRole] = useState<MapRole>(can.admin ? 'member' : 'viewer');
  const add = useMutation({
    mutationFn: (body: CreateAccessRuleRequest) =>
      api<AccessRuleDto>(buildPath(routes.access.add.path, { mapId: map.id }), {
        method: 'POST',
        json: body,
      }),
    onSuccess: (rule) => {
      setSubject(emptySubject(subject.kind));
      void queryClient.invalidateQueries({ queryKey: rulesKey(map.id) });
      toast({
        title: `${rule.subject?.name ?? 'Rule'} added as ${ROLE_LABEL[rule.role].toLowerCase()}`,
        tone: 'success',
      });
    },
  });
  const request = subjectRequest(subject);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (request) add.mutate({ ...request, role });
  };
  const instanceAdmin =
    me.data?.account.instanceRole === 'owner' || me.data?.account.instanceRole === 'admin';
  const error = add.error ? errorText(add.error, 'Could not add the rule.') : undefined;

  return (
    <Card>
      <form onSubmit={submit} aria-label="Add access rule">
        <CardHeader
          title="Add a rule"
          description={
            can.admin
              ? 'Find them by name.'
              : 'Find them by name. As a manager you let people in as viewer or member, or block them.'
          }
        />
        <CardBody>
          <div className={styles.ruleGrid}>
            <Field label="Who">
              <Select
                value={subject.kind}
                options={kinds.map((k) => ({ value: k, label: SUBJECT[k].label, icon: SUBJECT[k].icon }))}
                onValueChange={(k) => {
                  add.reset();
                  setSubject(emptySubject(k as AccessSubjectKind));
                }}
              />
            </Field>
            {subject.kind === 'account' ? (
              <Field label="Person" error={error}>
                <AccountPicker
                  value={subject.picked}
                  onChange={(picked) => setSubject({ kind: 'account', picked })}
                />
              </Field>
            ) : subject.kind === 'discordRole' ? (
              bot ? (
                <>
                  <Field label="Discord server">
                    <GuildSelect
                      value={subject.guildId}
                      onChange={(guildId) => setSubject({ kind: 'discordRole', guildId, roleId: null })}
                    />
                  </Field>
                  <Field label="Role" error={error}>
                    <RoleSelect
                      guildId={subject.guildId}
                      value={subject.roleId}
                      onChange={(roleId) => setSubject({ ...subject, roleId })}
                    />
                  </Field>
                </>
              ) : (
                <div className={styles.ruleWide}>
                  <Callout tone="neutral" title="Discord roles need the bot">
                    <BotHint admin={instanceAdmin} />
                  </Callout>
                </div>
              )
            ) : (
              <Field label={SUBJECT[subject.kind].label} error={error}>
                <EvePicker
                  category={subject.kind}
                  value={subject.picked}
                  onChange={(picked) => setSubject({ kind: subject.kind, picked } as Subject)}
                />
              </Field>
            )}
            <Field label="Map role" hint={ROLE_HINT[role]}>
              <Select
                value={role}
                options={MapRole.options
                  .filter((r) => can.admin || assignable(r))
                  .map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                onValueChange={(r) => setRole(r as MapRole)}
              />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" icon={<Plus />} loading={add.isPending} disabled={!request}>
            Add rule
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

const NO_MAP = '__none__';

/** Wanderer's reusable access lists, done as a copy: rules stay on each map. */
function CopyRulesCard({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const maps = useMaps();
  const sources = (maps.data ?? []).filter(
    (m) => m.id !== map.id && (m.role === 'manager' || m.role === 'admin'),
  );
  const [from, setFrom] = useState(NO_MAP);
  const [overwrite, setOverwrite] = useState(false);
  const copy = useMutation({
    mutationFn: () =>
      api<CopyAccessRulesResultDto>(buildPath(routes.accessRules.copy.path, { mapId: map.id }), {
        method: 'POST',
        json: { fromMapId: from, overwrite },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(map.id) });
      const parts = [
        `${result.added} added`,
        ...(result.updated ? [`${result.updated} changed`] : []),
        ...(result.skipped ? [`${result.skipped} already here`] : []),
      ];
      toast({ title: 'Rules copied', description: parts.join(', '), tone: 'success' });
      setFrom(NO_MAP);
    },
    onError: (error) =>
      toast({
        title: 'Could not copy the rules',
        description: errorText(error, 'Try again.'),
        tone: 'danger',
      }),
  });
  return (
    <Card>
      <CardHeader
        title="Copy rules from another map"
        description="Adds the rules of a map you manage to this one, so a staging map lets in the same people. Later changes there do not follow."
      />
      <CardBody>
        <div className={styles.formStack}>
          <Field label="From map">
            <Select
              value={from}
              disabled={!maps.data || sources.length === 0}
              placeholder={maps.data ? undefined : 'Loading maps…'}
              options={[
                { value: NO_MAP, label: sources.length ? 'Pick a map' : 'No other map you manage' },
                ...sources.map((m) => ({ value: m.id, label: m.name })),
              ]}
              onValueChange={setFrom}
            />
          </Field>
          <Switch
            checked={overwrite}
            onCheckedChange={setOverwrite}
            label="Take their roles over the rules here"
            description="Off: people who already have a rule here keep it."
          />
        </div>
      </CardBody>
      <CardFooter>
        <Button
          icon={<Copy />}
          loading={copy.isPending}
          disabled={from === NO_MAP}
          onClick={() => copy.mutate()}
        >
          Copy rules
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Who may open the map at all, and whom offline characters are shown to. */
function OpeningCard({ map }: { map: MapDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (settings: NonNullable<UpdateMapRequest['settings']>) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), {
        method: 'PATCH',
        json: { settings },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      toast({ title: 'Saved', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  return (
    <Card>
      <CardHeader
        title="Characters on this map"
        description="What everyone who can open the map must do, and what they see."
      />
      <CardBody>
        <div className={styles.formStack}>
          <Switch
            checked={map.settings.onlyTrackedCharacters ?? false}
            disabled={save.isPending}
            onCheckedChange={(on) => save.mutate({ onlyTrackedCharacters: on })}
            label="Only with every character tracked"
            description="The map opens for someone only once all their characters are tracked on it."
          />
          <Switch
            checked={map.settings.offlineForManagersOnly ?? false}
            disabled={save.isPending}
            onCheckedChange={(on) => save.mutate({ offlineForManagersOnly: on })}
            label="Offline characters for managers only"
            description="Viewers and members see only characters that are online."
          />
        </div>
      </CardBody>
    </Card>
  );
}
