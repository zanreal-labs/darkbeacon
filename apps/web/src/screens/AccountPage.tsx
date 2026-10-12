'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Laptop,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Smartphone,
  Star,
  Tablet,
  Unlink,
  UserRound,
} from 'lucide-react';
import {
  buildPath,
  routes,
  type CharacterDto,
  type EveEntityDto,
  type MeDto,
  type SessionDto,
} from '@darkbeacon/shared';
import { accountImage } from '../lib/account';
import { api, ApiError } from '../lib/api';
import { usePresenceSettings } from '../lib/presence';
import { useMaps, useSetDefaultMap } from '../lib/maps';
import { meKey, useLogout, useMe, useProviders, useRevokeSession, useSessions } from '../lib/session';
import { relativeTime } from '../lib/time';
import { eveLinkHref, ROLE_LABEL } from '../shell/AccountMenu';
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
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
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
import styles from './AccountPage.module.css';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

const TITLE = 'Account';
const DESCRIPTION = 'Your sign-in, EVE characters and preferences.';

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
        <Characters me={me.data} />
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

        <Sessions />
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

function useEntities(ids: number[]) {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  return useQuery({
    queryKey: ['eve-entities', unique.join(',')],
    queryFn: () => api<EveEntityDto[]>(`${routes.eve.entities.path}?ids=${unique.join(',')}`),
    enabled: unique.length > 0,
    staleTime: 60 * 60_000,
  });
}

function Characters({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const providers = useProviders();
  const [unlinking, setUnlinking] = useState<CharacterDto | null>(null);
  const { account, characters } = me;
  const eve = providers.data?.eve ?? false;
  const eveMode = providers.data?.loginMethod === 'eve';
  const groups = useEntities(
    characters.flatMap((c) => [c.corporationId, ...(c.allianceId ? [c.allianceId] : [])]),
  );
  const groupName = (id: number | null) => {
    if (!id) return null;
    const e = groups.data?.find((g) => g.id === id);
    return e ? `${e.name}${e.ticker ? ` [${e.ticker}]` : ''}` : null;
  };

  const setMain = useMutation({
    mutationFn: (characterId: number) =>
      api<MeDto>(routes.accounts.setMainCharacter.path, { method: 'PUT', json: { characterId } }),
    onSuccess: (data, id) => {
      queryClient.setQueryData(meKey, data);
      const name = data.characters.find((c) => c.id === id)?.name;
      toast({ title: `${name ?? 'Character'} is now your main`, tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not change the main character', description: errorText(error), tone: 'danger' }),
  });
  const unlink = useMutation({
    mutationFn: (characterId: number) =>
      api<void>(buildPath(routes.accounts.unlinkCharacter.path, { characterId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
    onError: (error) => toast({ title: 'Could not unlink', description: errorText(error), tone: 'danger' }),
  });

  const linkButton = (
    <Button asChild={eve} variant="primary" size="sm" icon={<Plus />} disabled={!eve}>
      {eve ? (
        <a href={eveLinkHref()}>{eveMode ? 'Add a character' : 'Link EVE character'}</a>
      ) : (
        'Link EVE character'
      )}
    </Button>
  );

  return (
    <Card>
      <CardHeader
        title="EVE characters"
        description={
          eveMode
            ? 'Every character here signs you in to this account. Your main is who you act as on maps.'
            : 'Linked through EVE SSO. Your main character is who you act as on maps.'
        }
        actions={
          eve ? (
            linkButton
          ) : (
            <Tooltip content="EVE SSO isn't configured on this server (EVE_CLIENT_ID / EVE_CLIENT_SECRET).">
              <span tabIndex={0}>{linkButton}</span>
            </Tooltip>
          )
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
              const main = account.mainCharacterId === c.id;
              const affiliation = [groupName(c.corporationId), groupName(c.allianceId)]
                .filter(Boolean)
                .join(' · ');
              return (
                <Row
                  key={c.id}
                  leading={<CharacterAvatar id={c.id} name={c.name} size={36} />}
                  title={
                    <>
                      <span>{c.name}</span>
                      {main && (
                        <Badge tone="accent" icon={<Star />}>
                          Main
                        </Badge>
                      )}
                      {!c.tokenValid && <Badge tone="danger">Login expired</Badge>}
                      {c.tokenValid && c.canSearch === false && (
                        <Tooltip content="Linked before Darkbeacon asked for search. Link it again so name pickers can search through it.">
                          <span tabIndex={0}>
                            <Badge tone="warning">Search off</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </>
                  }
                  meta={
                    !c.tokenValid ? (
                      <span className="error">Link the character again to resume tracking.</span>
                    ) : groups.isPending && affiliation === '' ? (
                      <Skeleton width={160} height={10} />
                    ) : (
                      affiliation || 'No corporation found'
                    )
                  }
                  actions={
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton
                          label={`Actions for ${c.name}`}
                          icon={<MoreHorizontal />}
                          tooltip={false}
                        />
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem
                          icon={<Star />}
                          disabled={main || setMain.isPending}
                          onSelect={() => setMain.mutate(c.id)}
                        >
                          Make main character
                        </MenuItem>
                        {eve && (
                          <MenuItem icon={<RefreshCw />} href={eveLinkHref()}>
                            Link again
                          </MenuItem>
                        )}
                        <MenuItem icon={<Unlink />} tone="danger" onSelect={() => setUnlinking(c)}>
                          Unlink…
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  }
                />
              );
            })}
          </Rows>
        )}
      </CardBody>
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={`Unlink ${unlinking?.name ?? 'character'}?`}
        description={
          eveMode
            ? 'Tracking stops on every map, and the character no longer signs you in. You can add it again later.'
            : 'Tracking stops on every map. You can link the character again later.'
        }
        confirmLabel="Unlink"
        tone="danger"
        onConfirm={() => (unlinking ? unlink.mutateAsync(unlinking.id) : undefined)}
      />
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
