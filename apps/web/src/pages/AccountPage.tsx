import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { LogOut, MoreHorizontal, Plus, Star, Unlink, UserRound } from 'lucide-react';
import { buildPath, routes, type CharacterDto, type MeDto } from '@wormwright/shared';
import { api, ApiError } from '../lib/api';
import { meKey, useLogout, useMe, useProviders } from '../lib/session';
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
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Page,
  PageHeader,
  Row,
  Rows,
  Stack,
  Tooltip,
  useToast,
} from '../ui';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

/** Discord identity, linked EVE characters (main character, link, unlink), theme and sessions. */
export function AccountPage() {
  const me = useMe();
  // EVE SSO failures come back as ?auth_error=<message>.
  const [params] = useSearchParams();
  const authError = params.get('auth_error');
  if (!me.data) return null;
  const { account } = me.data;

  return (
    <Page width={760}>
      <PageHeader title="Account" description="Your sign-in, EVE characters and preferences." />
      <Stack>
        {authError && (
          <Callout tone="danger" title="EVE sign-in didn't work">
            {authError}
          </Callout>
        )}

        <Card>
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ww-space-3)' }}>
              <Avatar src={account.avatarUrl} name={account.name} size={48} />
              <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 'var(--ww-font-size-large)' }}>{account.name}</strong>
                <span className="muted">
                  {account.discordId ? 'Signed in with Discord' : 'Local demo account, not linked to Discord'}
                </span>
              </div>
              <Badge tone={account.instanceRole === 'user' ? 'neutral' : 'accent'}>
                {ROLE_LABEL[account.instanceRole]}
              </Badge>
            </div>
          </CardBody>
        </Card>

        <Characters me={me.data} />

        <Card>
          <CardHeader
            title="Appearance"
            description="System follows your computer's light or dark mode. Saved to your account."
          />
          <CardBody>
            <ThemePicker />
          </CardBody>
        </Card>

        <Sessions />
      </Stack>
    </Page>
  );
}

function Characters({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const providers = useProviders();
  const [unlinking, setUnlinking] = useState<CharacterDto | null>(null);
  const { account, characters } = me;
  const eve = providers.data?.eve ?? false;

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
        <a href={eveLinkHref()}>
          <Plus />
          <span>Link EVE character</span>
        </a>
      ) : (
        'Link EVE character'
      )}
    </Button>
  );

  return (
    <Card>
      <CardHeader
        title="EVE characters"
        description="Linked through EVE SSO. Your main character is who you act as on maps."
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
                    </>
                  }
                  meta={
                    !c.tokenValid ? (
                      <span className="error">Link the character again to resume tracking.</span>
                    ) : (
                      <span className="mono">#{c.id}</span>
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
        description="Tracking stops on every map. You can link the character again later."
        confirmLabel="Unlink"
        tone="danger"
        onConfirm={() => (unlinking ? unlink.mutateAsync(unlinking.id) : undefined)}
      />
    </Card>
  );
}

function Sessions() {
  const navigate = useNavigate();
  const logout = useLogout();
  const logoutEverywhere = useLogout(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const done = () => void navigate('/login', { replace: true });
  return (
    <Card>
      <CardHeader title="Sessions" description="Signing out everywhere ends your sessions on every device." />
      <CardFooter>
        <Button variant="danger-ghost" onClick={() => setConfirmAll(true)}>
          Sign out everywhere
        </Button>
        <Button
          icon={<LogOut />}
          loading={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: done })}
        >
          Sign out
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere?"
        description="Every browser and device signed in to this account is signed out, including this one."
        confirmLabel="Sign out everywhere"
        tone="danger"
        onConfirm={() => logoutEverywhere.mutateAsync().then(done)}
      />
    </Card>
  );
}
