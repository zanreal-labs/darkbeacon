'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Bot, Link2, Send } from 'lucide-react';
import {
  buildPath,
  DISCORD_URGENT_KINDS,
  DiscordNotifyKind,
  routes,
  type DiscordNotifySettings,
  type DiscordNotifyStateDto,
  type DiscordNotifyTestDto,
  type MapDto,
  type UpdateDiscordNotifyRequest,
} from '@darkbeacon/shared';
import { ChannelSelect, GuildSelect, RoleSelect } from '../components/pickers';
import { api, ApiError } from '../lib/api';
import { isInstanceAdmin, useMe } from '../lib/session';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ChoiceGroup,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '../ui';
import styles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** The kinds in the words the settings use; urgent ones may mention. */
const KINDS: Record<DiscordNotifyKind, { label: string; hint: string }> = {
  connections: { label: 'New connections', hint: 'Called out louder when one opens a way to known space' },
  eol: { label: 'End of life or critical', hint: 'A connection is marked EOL or critical mass' },
  danger: { label: 'Danger', hint: 'A connection is marked dangerous or bubbled, a system hostile' },
  kills: { label: 'Kills in the chain', hint: 'From zKillboard, for every system on the map' },
  pings: { label: 'Rally pings', hint: 'Pings set on the map' },
  wayHome: {
    label: 'Way home',
    hint: 'The exits to known space from home, when they change (at most every 15 min)',
  },
  arrivals: { label: 'Characters entering the chain', hint: 'Tracked pilots jumping in from outside' },
};

const URGENT: readonly DiscordNotifyKind[] = DISCORD_URGENT_KINDS;

/** EVE runs on UTC; a few common zones, plus the browser's own. */
function timeZones(current: string): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    ...new Set([
      'UTC',
      own,
      'Europe/London',
      'Europe/Berlin',
      'Europe/Warsaw',
      'America/New_York',
      'America/Chicago',
      'America/Los_Angeles',
      'Australia/Sydney',
      current,
    ]),
  ];
}

const notifyKey = (mapId: string) => ['discord-notify', mapId] as const;

/** The Discord part of a map's Notifications tab (the bundled discord-notify plugin). */
export function DiscordNotifications({ map }: { map: MapDto }) {
  const me = useMe();
  const state = useQuery({
    queryKey: notifyKey(map.id),
    queryFn: () => api<DiscordNotifyStateDto>(buildPath(routes.discordNotify.get.path, { mapId: map.id })),
    retry: false,
  });

  if (state.isPending) {
    return (
      <Card>
        <CardHeader title="Discord" description="Posts what matters on this map to a Discord channel." />
        <CardBody>
          <Skeleton height={120} radius={8} />
        </CardBody>
      </Card>
    );
  }
  if (state.isError) {
    const off = state.error instanceof ApiError && state.error.status === 404;
    return (
      <Card>
        <CardHeader title="Discord" description="Posts what matters on this map to a Discord channel." />
        <CardBody>
          {off ? (
            <EmptyState
              compact
              icon={<BellOff />}
              title="Discord notifications are switched off"
              description={
                isInstanceAdmin(me.data)
                  ? 'Switch the Discord notifications plugin on in Admin, Plugins (on this map too).'
                  : 'An instance admin can switch the Discord notifications plugin on.'
              }
              actions={
                isInstanceAdmin(me.data) && (
                  <Button asChild>
                    <Link href="/admin?tab=plugins">Open plugins</Link>
                  </Button>
                )
              }
            />
          ) : (
            <ErrorState compact error={state.error} onRetry={() => void state.refetch()} />
          )}
        </CardBody>
      </Card>
    );
  }
  return <DiscordSettings key={JSON.stringify(state.data.target)} map={map} state={state.data} />;
}

function DiscordSettings({ map, state }: { map: MapDto; state: DiscordNotifyStateDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<DiscordNotifySettings | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const settings: DiscordNotifySettings = draft ?? state;
  const change = (patch: Partial<DiscordNotifySettings>) => setDraft({ ...settings, ...patch });
  const path = buildPath(routes.discordNotify.update.path, { mapId: map.id });

  const save = useMutation({
    mutationFn: (body: UpdateDiscordNotifyRequest) =>
      api<DiscordNotifyStateDto>(path, { method: 'PUT', json: body }),
    onSuccess: (data) => {
      queryClient.setQueryData(notifyKey(map.id), data);
      setDraft(null);
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<DiscordNotifyTestDto>(buildPath(routes.discordNotify.test.path, { mapId: map.id }), {
        method: 'POST',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: notifyKey(map.id) });
      toast(
        result.ok
          ? { title: 'Test posted', description: 'Check the channel.', tone: 'success' }
          : { title: 'Test failed', description: result.error ?? 'Discord did not take it.', tone: 'danger' },
      );
    },
    onError: (error) =>
      toast({ title: 'Test failed', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });

  const status = state.status;
  const failing =
    status.lastErrorAt !== null && (status.lastSentAt === null || status.lastErrorAt > status.lastSentAt);
  const badge = !state.target ? (
    <Badge>Not connected</Badge>
  ) : !settings.enabled ? (
    <Badge>Paused</Badge>
  ) : failing ? (
    <Badge tone="danger" dot>
      Failing
    </Badge>
  ) : (
    <Badge tone="success" dot>
      Posting
    </Badge>
  );

  if (!state.target) return <ConnectTarget map={map} bot={state.bot} badge={badge} />;

  return (
    <Card>
      <CardHeader
        title={<span className={styles.rowTitle}>Discord {badge}</span>}
        description="Posts what matters on this map to a Discord channel, a few seconds after it happens."
        actions={
          state.target && (
            <Switch
              checked={settings.enabled}
              disabled={save.isPending}
              onCheckedChange={(enabled) =>
                save.mutate(
                  { enabled },
                  {
                    onError: (e) =>
                      toast({
                        title: 'Could not save',
                        description: errorText(e, 'Try again.'),
                        tone: 'danger',
                      }),
                  },
                )
              }
              label={<span className="sr-only">Post to Discord</span>}
            />
          )
        }
      />
      <CardBody>
        <div className={styles.formStack}>
          <div className={styles.target}>
            <span className={styles.subjectIcon} aria-hidden>
              {state.target.kind === 'channel' ? <Bot /> : <Link2 />}
            </span>
            <div className={styles.rowBody}>
              <div className={styles.rowTitle}>{state.target.label}</div>
              <div className={styles.rowMeta}>
                {status.lastSentAt ? `Last posted ${relativeTime(status.lastSentAt)}` : 'Nothing posted yet'}
                {status.pending > 0 && ` · ${status.pending} waiting`}
              </div>
            </div>
            <Button size="sm" onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </div>
          {failing && status.lastError && (
            <Callout tone="danger" title={`Posting failed ${relativeTime(status.lastErrorAt!)}`}>
              {status.lastError}
            </Callout>
          )}

          {state.target && (
            <>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>What to post</legend>
                <div className={styles.eventPicker}>
                  {DiscordNotifyKind.options.map((kind) => (
                    <Checkbox
                      key={kind}
                      checked={settings.kinds[kind]}
                      onCheckedChange={(on) => change({ kinds: { ...settings.kinds, [kind]: on } })}
                      label={KINDS[kind].label}
                      description={KINDS[kind].hint}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Mentions</legend>
                <div className={styles.grid}>
                  <Field label="Mention" hint="Only for the urgent kinds ticked below.">
                    <Select
                      value={settings.mention.kind}
                      options={[
                        { value: 'none', label: 'Nobody' },
                        { value: 'here', label: '@here' },
                        ...(state.target.kind === 'channel' ? [{ value: 'role', label: 'A role' }] : []),
                      ]}
                      onValueChange={(kind) =>
                        change({
                          mention: {
                            ...settings.mention,
                            kind: kind as 'none' | 'here' | 'role',
                            roleId: kind === 'role' ? settings.mention.roleId : null,
                          },
                        })
                      }
                    />
                  </Field>
                  {settings.mention.kind === 'role' && state.target.kind === 'channel' && (
                    <Field label="Role">
                      <RoleSelect
                        guildId={state.target.guildId}
                        value={settings.mention.roleId}
                        onChange={(roleId) => change({ mention: { ...settings.mention, roleId } })}
                      />
                    </Field>
                  )}
                </div>
                {settings.mention.kind !== 'none' && (
                  <div className={styles.eventPicker}>
                    {URGENT.map((kind) => (
                      <Checkbox
                        key={kind}
                        checked={settings.mention.kinds.includes(
                          kind as (typeof DISCORD_URGENT_KINDS)[number],
                        )}
                        disabled={!settings.kinds[kind]}
                        onCheckedChange={(on) =>
                          change({
                            mention: {
                              ...settings.mention,
                              kinds: on
                                ? [...settings.mention.kinds, kind as (typeof DISCORD_URGENT_KINDS)[number]]
                                : settings.mention.kinds.filter((k) => k !== kind),
                            },
                          })
                        }
                        label={`Mention on ${KINDS[kind].label.toLowerCase()}`}
                      />
                    ))}
                  </div>
                )}
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Quiet hours</legend>
                <Switch
                  checked={settings.quietHours.enabled}
                  onCheckedChange={(enabled) => change({ quietHours: { ...settings.quietHours, enabled } })}
                  label="Keep quiet at night"
                  description="Only urgent kinds are posted then, and without mentions."
                />
                {settings.quietHours.enabled && (
                  <div className={styles.grid}>
                    <Field label="From">
                      <Input
                        type="time"
                        value={settings.quietHours.start}
                        onChange={(e) =>
                          change({ quietHours: { ...settings.quietHours, start: e.target.value } })
                        }
                      />
                    </Field>
                    <Field label="Until">
                      <Input
                        type="time"
                        value={settings.quietHours.end}
                        onChange={(e) =>
                          change({ quietHours: { ...settings.quietHours, end: e.target.value } })
                        }
                      />
                    </Field>
                    <Field label="Time zone">
                      <Select
                        value={settings.quietHours.timeZone}
                        options={timeZones(settings.quietHours.timeZone).map((z) => ({
                          value: z,
                          label: z === 'UTC' ? 'UTC (EVE time)' : z.replace(/_/g, ' '),
                        }))}
                        onValueChange={(timeZone) =>
                          change({ quietHours: { ...settings.quietHours, timeZone } })
                        }
                      />
                    </Field>
                  </div>
                )}
              </fieldset>
              {save.error && <span className="error">{errorText(save.error, 'Could not save.')}</span>}
            </>
          )}
        </div>
      </CardBody>
      {state.target && (
        <CardFooter>
          <Button icon={<Send />} loading={test.isPending} onClick={() => test.mutate()}>
            Send test
          </Button>
          {draft && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!draft}
            onClick={() => {
              const { kinds, mention, quietHours } = settings;
              save.mutate(
                { kinds, mention, quietHours },
                { onSuccess: () => toast({ title: 'Discord notifications saved', tone: 'success' }) },
              );
            }}
          >
            Save
          </Button>
        </CardFooter>
      )}
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Discord?"
        description="Nothing more is posted, and messages waiting to go out are dropped. Your choices are kept."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => save.mutateAsync({ target: null })}
      />
    </Card>
  );
}

/** Where the posts go: a server and channel the instance bot is in, or a channel webhook. */
function ConnectTarget({ map, bot, badge }: { map: MapDto; bot: boolean; badge: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'webhook' | 'channel'>(bot ? 'channel' : 'webhook');
  const [url, setUrl] = useState('');
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: (body: UpdateDiscordNotifyRequest) =>
      api<DiscordNotifyStateDto>(buildPath(routes.discordNotify.update.path, { mapId: map.id }), {
        method: 'PUT',
        json: body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(notifyKey(map.id), data);
      toast({
        title: `Connected to ${data.target?.label ?? 'Discord'}`,
        description: 'Send a test to check it.',
        tone: 'success',
      });
    },
  });
  const ready = kind === 'webhook' ? url.trim().length > 0 : guildId !== null && channelId !== null;
  const error = connect.error ? errorText(connect.error, 'Could not connect.') : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    connect.mutate({
      target:
        kind === 'webhook'
          ? { kind: 'webhook', url: url.trim() }
          : { kind: 'channel', guildId: guildId!, channelId: channelId! },
      enabled: true,
    });
  };
  return (
    <Card>
      <form onSubmit={submit} aria-label="Connect Discord">
        <CardHeader
          title={<span className={styles.rowTitle}>Discord {badge}</span>}
          description="Posts what matters on this map to a Discord channel, a few seconds after it happens."
        />
        <CardBody>
          <div className={styles.formStack}>
            <ChoiceGroup
              aria-label="Where to post"
              value={kind}
              onValueChange={(k) => setKind(k as 'webhook' | 'channel')}
              options={[
                {
                  value: 'channel',
                  label: 'A channel, through the bot',
                  icon: <Bot />,
                  disabled: !bot,
                  description: bot
                    ? 'Pick the server and channel. The bot can also mention a role.'
                    : 'Needs the instance bot (Admin, Instance, Discord bot).',
                },
                {
                  value: 'webhook',
                  label: 'A channel webhook',
                  icon: <Link2 />,
                  description:
                    'In Discord: channel settings, Integrations, Webhooks, New webhook, Copy webhook URL.',
                },
              ]}
            />
            {kind === 'webhook' ? (
              <Field label="Webhook URL" error={error}>
                <Input
                  type="url"
                  autoComplete="off"
                  placeholder="https://discord.com/api/webhooks/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            ) : (
              <div className={styles.grid}>
                <Field label="Server">
                  <GuildSelect
                    value={guildId}
                    onChange={(id) => {
                      setGuildId(id);
                      setChannelId(null);
                    }}
                  />
                </Field>
                <Field label="Channel" error={error}>
                  <ChannelSelect guildId={guildId} value={channelId} onChange={setChannelId} />
                </Field>
              </div>
            )}
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" variant="primary" loading={connect.isPending} disabled={!ready}>
            Connect
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
