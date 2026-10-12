'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Laptop, LogOut, Smartphone, Star, Tablet, UserRound, UsersRound } from 'lucide-react';
import { routes, type MeDto, type SessionDto } from '@darkbeacon/shared';
import { accountImage } from '../lib/account';
import { api, ApiError } from '../lib/api';
import { usePresenceSettings } from '../lib/presence';
import { useMaps, useSetDefaultMap } from '../lib/maps';
import { meKey, useLogout, useMe, useProviders, useRevokeSession, useSessions } from '../lib/session';
import { relativeTime } from '../lib/time';
import { usePageView } from '../lib/useTelemetry';
import { attentionText, charactersNeedingAttention } from '../lib/scope-health';
import { ROLE_LABEL } from '../shell/AccountMenu';
import { ThemePicker } from '../theme/ThemePicker';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CharacterAvatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Page,
  PageHeader,
  Row,
  Rows,
  Select,
  Skeleton,
  SkeletonRows,
  Stack,
  Switch,
  Tooltip,
  useToast,
} from '../ui';
import { ApiKeysCard } from './ApiKeysCard';
import { MyPreferences } from './MyPreferences';
import { ConnectedAppsCard } from './ConnectedAppsCard';
import styles from './AccountPage.module.css';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

const TITLE = 'Account';
const DESCRIPTION = 'Your sign-in, EVE characters, preferences and API keys.';

/** The account page as it looks while the account streams in. */
export function AccountPageSkeleton() {
  return (
    <Page width={760} aria-busy="true">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Stack>
        <Skeleton width="100%" height={88} radius={10} />
        <Skeleton width="100%" height={180} radius={10} />
      </Stack>
    </Page>
  );
}

/**
 * Sign-in (and Discord on EVE instances), linked EVE characters, the map that opens first, theme
 * and the signed-in devices. `authError`: an EVE SSO or Discord failure (`?auth_error=`).
 */
export function AccountPage({ authError = null }: { authError?: string | null }) {
  const me = useMe();
  usePageView('account');
  if (!me.data) return null;

  return (
    <Page width={760}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Stack>
        {authError && (
          <Callout tone="danger" title="That didn't work">
            {authError}
          </Callout>
        )}
        <Identity me={me.data} />
        <CharactersSummary me={me.data} />
        <DefaultMap me={me.data} />
        <Card>
          <CardHeader
            title="Appearance"
            description="System follows your computer's light or dark mode. Saved to your account."
          />
          <CardBody>
            <ThemePicker />
          </CardBody>
        </Card>

        <Collaboration />

        <MyPreferences />

        <Sessions />

        <ApiKeysCard />
        <ConnectedAppsCard />
      </Stack>
    </Page>
  );
}

function Identity({ me }: { me: MeDto }) {
  const providers = useProviders();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [disconnecting, setDisconnecting] = useState(false);
  const { account } = me;
  const eveMode = providers.data?.loginMethod === 'eve';
  const canConnect = eveMode && (providers.data?.discord ?? false);
  const disconnect = useMutation({
    mutationFn: () => api<void>(routes.accounts.disconnectDiscord.path, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meKey });
      toast({ title: 'Discord disconnected', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not disconnect', description: errorText(error), tone: 'danger' }),
  });
  const how =
    providers.data?.demo && !account.discordId
      ? 'The shared demo account: everyone exploring the demo uses it.'
      : eveMode
        ? 'Signed in with EVE Online: any of your characters opens this account.'
        : account.discordId
          ? 'Signed in with Discord.'
          : 'A local account, not linked to Discord.';
  const connectHref = `${routes.auth.discordConnect.path}?${new URLSearchParams({ returnTo: '/account' })}`;

  return (
    <Card>
      <CardBody>
        <div className={styles.identity}>
          <Avatar src={accountImage(me)} name={account.name} size={48} />
          <div className={styles.identityText}>
            <strong>{account.name}</strong>
            <span className="muted">{how}</span>
          </div>
          <Badge tone={account.instanceRole === 'user' ? 'neutral' : 'accent'}>
            {ROLE_LABEL[account.instanceRole]}
          </Badge>
        </div>
      </CardBody>
      {canConnect && (
        <CardFooter>
          <span className={styles.footerNote}>
            {account.discordId
              ? 'Discord is connected: its roles can count on maps.'
              : 'Connect Discord to sign in with it too and bring your server roles along.'}
          </span>
          {account.discordId ? (
            <Button onClick={() => setDisconnecting(true)}>Disconnect Discord</Button>
          ) : (
            <Button asChild>
              <a href={connectHref}>Connect Discord</a>
            </Button>
          )}
        </CardFooter>
      )}
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Discord?"
        description="Map access that came from your Discord roles ends. You keep signing in with EVE Online."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => disconnect.mutateAsync()}
      />
    </Card>
  );
}

/** My characters at a glance; the characters page manages them. */
function CharactersSummary({ me }: { me: MeDto }) {
  const { account, characters } = me;
  const attention = new Map(charactersNeedingAttention(me).map((a) => [a.character.id, a]));
  return (
    <Card>
      <CardHeader
        title="EVE characters"
        description="Where they are, what they allow and which maps track them is on the characters page."
        actions={
          <Button asChild size="sm" icon={<UsersRound />}>
            <Link href="/characters">Manage characters</Link>
          </Button>
        }
      />
      <CardBody flush>
        {characters.length === 0 ? (
          <EmptyState
            compact
            icon={<UserRound />}
            title="No characters yet"
            description="Link an EVE character to track your location and ship on maps."
          />
        ) : (
          <Rows>
            {characters.map((c) => {
              const a = attention.get(c.id);
              return (
                <Row
                  key={c.id}
                  leading={<CharacterAvatar id={c.id} name={c.name} size={28} />}
                  title={
                    <>
                      <span>{c.name}</span>
                      {account.mainCharacterId === c.id && (
                        <Badge tone="accent" icon={<Star />}>
                          Main
                        </Badge>
                      )}
                      {a?.expired && <Badge tone="danger">Login expired</Badge>}
                      {a && !a.expired && (
                        <Tooltip content={attentionText(a)}>
                          <span tabIndex={0}>
                            <Badge tone="warning">Needs re-link</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </>
                  }
                />
              );
            })}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}

/** Live cursors on maps: whether others see mine, whether I see theirs. Kept on the server. */
function Collaboration() {
  const { settings, update } = usePresenceSettings();
  const toast = useToast();
  const change = (patch: { shareCursor?: boolean; showOthers?: boolean }) =>
    update.mutate(patch, {
      onError: (error) => toast({ title: 'Could not save', description: errorText(error), tone: 'danger' }),
    });
  return (
    <Card>
      <CardHeader
        title="Live cursors"
        description="On a map, everyone sees who else is there and what they are editing. Cursors and drags are up to you."
      />
      <CardBody>
        <div style={{ display: 'grid', gap: 'var(--dbk-space-4)' }}>
          <Switch
            checked={settings.data?.shareCursor ?? true}
            disabled={!settings.data}
            onCheckedChange={(shareCursor) => change({ shareCursor })}
            label="Share my cursor"
            description="Others on the map see where you point and where you drag systems."
          />
          <Switch
            checked={settings.data?.showOthers ?? true}
            disabled={!settings.data}
            onCheckedChange={(showOthers) => change({ showOthers })}
            label="Show other people's cursors"
            description="Turn off for a calmer map; you still see who is there."
          />
        </div>
      </CardBody>
    </Card>
  );
}

/** Value of "no star": `/` then opens the instance default or the map used last. */
const NO_DEFAULT = '__last__';

function DefaultMap({ me }: { me: MeDto }) {
  const maps = useMaps();
  const star = useSetDefaultMap();
  const toast = useToast();
  const value = me.account.defaultMapId ?? NO_DEFAULT;
  return (
    <Card>
      <CardHeader
        title="Map that opens first"
        description="Where Darkbeacon takes you when you open it or press the map button."
      />
      <CardBody>
        {maps.isError ? (
          <ErrorState compact error={maps.error} onRetry={() => void maps.refetch()} />
        ) : (
          <Field
            label="Opens first"
            hint="You can also star a map in the map switcher, next to the map's name."
          >
            <Select
              value={maps.data ? value : undefined}
              disabled={!maps.data || star.isPending}
              placeholder="Loading maps…"
              options={[
                { value: NO_DEFAULT, label: 'The map I used last' },
                ...(maps.data ?? []).map((m) => ({ value: m.id, label: m.name, icon: <Star /> })),
              ]}
              onValueChange={(id) =>
                star.mutate(id === NO_DEFAULT ? null : id, {
                  onSuccess: () => toast({ title: 'Saved', tone: 'success' }),
                  onError: (error) =>
                    toast({ title: 'Could not save', description: errorText(error), tone: 'danger' }),
                })
              }
            />
          </Field>
        )}
      </CardBody>
    </Card>
  );
}

const DEVICE_ICON = {
  desktop: <Laptop />,
  mobile: <Smartphone />,
  tablet: <Tablet />,
  unknown: <Laptop />,
} as const;

function sessionName(s: SessionDto): string {
  if (s.browser && s.os) return `${s.browser} on ${s.os}`;
  return s.browser ?? s.os ?? 'Unknown browser';
}

function Sessions() {
  const router = useRouter();
  const toast = useToast();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const logout = useLogout();
  const logoutEverywhere = useLogout(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const done = () => router.replace('/login');
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;
  return (
    <Card>
      <CardHeader title="Sessions" description="Browsers and devices signed in to this account." />
      <CardBody flush>
        {sessions.isPending ? (
          <SkeletonRows count={2} />
        ) : sessions.isError ? (
          <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <Rows>
            {sessions.data.map((s) => (
              <Row
                key={s.id}
                leading={
                  <span className={styles.device} aria-hidden>
                    {DEVICE_ICON[s.device]}
                  </span>
                }
                title={
                  <>
                    <span>{sessionName(s)}</span>
                    {s.current && <Badge tone="accent">This device</Badge>}
                  </>
                }
                meta={`${s.current ? 'Active now' : `Active ${relativeTime(s.lastSeenAt)}`} · signed in ${relativeTime(s.createdAt)}`}
                actions={
                  !s.current && (
                    <Button
                      size="sm"
                      loading={revoke.isPending && revoke.variables === s.id}
                      onClick={() =>
                        revoke.mutate(s.id, {
                          onSuccess: () => toast({ title: `${sessionName(s)} signed out`, tone: 'success' }),
                          onError: (error) =>
                            toast({
                              title: 'Could not sign it out',
                              description: errorText(error),
                              tone: 'danger',
                            }),
                        })
                      }
                    >
                      Sign out
                    </Button>
                  )
                }
              />
            ))}
          </Rows>
        )}
      </CardBody>
      <CardFooter>
        <Button
          icon={<LogOut />}
          loading={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: done })}
        >
          Sign out here
        </Button>
        <Button variant="danger" onClick={() => setConfirmAll(true)}>
          Sign out everywhere…
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere?"
        description={
          others > 0
            ? `This device and ${others} other${others === 1 ? '' : 's'} are signed out.`
            : 'Every browser and device signed in to this account is signed out, including this one.'
        }
        confirmLabel="Sign out everywhere"
        tone="danger"
        onConfirm={() => logoutEverywhere.mutateAsync().then(done)}
      />
    </Card>
  );
}
