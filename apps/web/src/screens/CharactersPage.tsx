'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  KeyRound,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Star,
  Unlink,
  UserRound,
  Wallet,
} from 'lucide-react';
import {
  buildPath,
  eveScopeLabel,
  routes,
  type CharacterDto,
  type CharacterLocationDto,
  type MeDto,
  type MyTrackingDto,
  type OptionalEveScope,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import {
  shipIconUrl,
  useEveEntities,
  useMyTracking,
  useSetTracking,
  useShipTypes,
  useWallet,
} from '../lib/characters';
import { relinkHref } from '../lib/scope-health';
import { meKey, useMe, useProviders } from '../lib/session';
import { relativeTime } from '../lib/time';
import { useUniverseSystems } from '../lib/universe';
import { usePageView } from '../lib/useTelemetry';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CharacterAvatar,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Page,
  PageHeader,
  Row,
  Rows,
  Skeleton,
  SkeletonRows,
  Stack,
  StatusDot,
  Tooltip,
  useToast,
} from '../ui';
import styles from './CharactersPage.module.css';

const TITLE = 'Characters';
const DESCRIPTION = 'Your EVE characters: where they are, what they allow and which maps track them.';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export function CharactersPageSkeleton() {
  return (
    <Page width={880} aria-busy="true">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Stack>
        <Skeleton width="100%" height={220} radius={10} />
        <Skeleton width="100%" height={160} radius={10} />
      </Stack>
    </Page>
  );
}

/**
 * `/characters`: Wanderer's Characters and Characters Tracking pages in one. Each character with
 * its corporation, where it is and in what, what its EVE grant lacks, its wallet when allowed;
 * then every map I can see with a switch per character. `authError`: an EVE SSO failure.
 */
export function CharactersPage({ authError = null }: { authError?: string | null }) {
  const me = useMe();
  const tracking = useMyTracking({ enabled: !!me.data });
  usePageView('characters');
  if (!me.data) return null;
  return (
    <Page width={880}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Stack>
        {authError && (
          <Callout tone="danger" title="That didn't work">
            {authError}
          </Callout>
        )}
        <CharactersCard me={me.data} tracking={tracking.data} />
        <TrackingCard me={me.data} tracking={tracking} />
      </Stack>
    </Page>
  );
}

const isk = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A wallet balance, blurred until clicked (as in Wanderer). */
function WalletBalance({ character }: { character: CharacterDto }) {
  const [shown, setShown] = useState(false);
  const wallet = useWallet(character.id, true);
  const value =
    wallet.data?.balance != null
      ? `${isk.format(wallet.data.balance)} ISK`
      : wallet.isPending
        ? '…'
        : 'Unavailable';
  return (
    <Tooltip content={shown ? 'Hide the balance' : 'Show the balance'}>
      <button
        type="button"
        className={styles.wallet}
        data-shown={shown || undefined}
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? `Wallet: ${value}` : 'Show wallet balance'}
      >
        <Wallet aria-hidden />
        <span className={styles.walletValue}>{value}</span>
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </button>
    </Tooltip>
  );
}

function whereLine(
  location: CharacterLocationDto | undefined,
  systemName: (id: number) => string | undefined,
  shipName: (id: number) => string | undefined,
): string {
  if (!location || location.updatedAt === null)
    return 'Not tracked yet: track it on a map to see where it is.';
  const system =
    location.solarSystemId !== null ? (systemName(location.solarSystemId) ?? '…') : 'Unknown system';
  const ship = location.shipTypeId !== null ? shipName(location.shipTypeId) : null;
  const parts = [system, ship ?? location.shipName, location.docked ? 'docked' : null].filter(Boolean);
  const when = location.online ? '' : ` · last seen ${relativeTime(location.updatedAt)}`;
  return `${parts.join(' · ')}${when}`;
}

function CharactersCard({ me, tracking }: { me: MeDto; tracking: MyTrackingDto | undefined }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const providers = useProviders();
  const [unlinking, setUnlinking] = useState<CharacterDto | null>(null);
  const { account, characters } = me;
  const eve = providers.data?.eve ?? false;
  const eveMode = providers.data?.loginMethod === 'eve';
  const groups = useEveEntities(characters.flatMap((c) => [c.corporationId, c.allianceId]));
  const locations = new Map((tracking?.characters ?? []).map((l) => [l.characterId, l]));
  const universe = useUniverseSystems(
    [...locations.values()].flatMap((l) => (l.solarSystemId === null ? [] : [l.solarSystemId])),
  );
  const ships = useShipTypes([...locations.values()].map((l) => l.shipTypeId));
  const groupName = (id: number | null) => {
    if (!id) return null;
    const e = groups.byId.get(id);
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
        <a href={relinkHref('/characters')}>{eveMode ? 'Add a character' : 'Link EVE character'}</a>
      ) : (
        'Link EVE character'
      )}
    </Button>
  );

  return (
    <Card>
      <CardHeader
        title="Your characters"
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
              const location = locations.get(c.id);
              const missing = c.missingScopes ?? [];
              const extras = c.extras ?? [];
              const affiliation = [groupName(c.corporationId), groupName(c.allianceId)]
                .filter(Boolean)
                .join(' · ');
              const relink = (more: OptionalEveScope[] = []) =>
                relinkHref('/characters', [...new Set([...extras, ...more])]);
              return (
                <Row
                  key={c.id}
                  className={styles.character}
                  leading={<CharacterAvatar id={c.id} name={c.name} size={40} />}
                  title={
                    <>
                      <span>{c.name}</span>
                      {main && (
                        <Badge tone="accent" icon={<Star />}>
                          Main
                        </Badge>
                      )}
                      {c.tokenValid && location?.online != null && (
                        <span className={styles.online}>
                          <StatusDot
                            color={
                              location.online ? 'var(--dbk-color-success)' : 'var(--dbk-color-text-subtle)'
                            }
                          />
                          {location.online ? 'Online' : 'Offline'}
                        </span>
                      )}
                      {!c.tokenValid && <Badge tone="danger">Login expired</Badge>}
                      {c.tokenValid && missing.length > 0 && (
                        <Tooltip
                          content={`Linked before Darkbeacon asked for: ${missing.map(eveScopeLabel).join(', ')}. Link it again to allow them.`}
                        >
                          <span tabIndex={0}>
                            <Badge tone="warning">Needs re-link</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </>
                  }
                  meta={
                    !c.tokenValid ? (
                      <span className="error">Link the character again to resume tracking.</span>
                    ) : (
                      <span className={styles.meta}>
                        <span>
                          {groups.pending && affiliation === '' ? (
                            <Skeleton width={160} height={10} />
                          ) : (
                            affiliation || 'No corporation found'
                          )}
                        </span>
                        <span className={styles.where}>
                          {location?.shipTypeId != null && location.online && (
                            <img src={shipIconUrl(location.shipTypeId)} alt="" width={16} height={16} />
                          )}
                          {whereLine(
                            location,
                            (id) => universe.get(id)?.name,
                            (id) => ships.get(id)?.name,
                          )}
                        </span>
                      </span>
                    )
                  }
                  actions={
                    <div className={styles.actions}>
                      {extras.includes('wallet') && c.tokenValid && <WalletBalance character={c} />}
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton
                            label={`Actions for ${c.name}`}
                            icon={<MoreHorizontal />}
                            tooltip={false}
                          />
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem
                            icon={<Star />}
                            disabled={main || setMain.isPending}
                            onSelect={() => setMain.mutate(c.id)}
                          >
                            Make main character
                          </MenuItem>
                          {eve && (
                            <>
                              <MenuItem icon={<RefreshCw />} href={relink()}>
                                Link again
                              </MenuItem>
                              <MenuSeparator />
                              <MenuLabel>Optional access</MenuLabel>
                              {!extras.includes('wallet') && (
                                <MenuItem icon={<Wallet />} href={relink(['wallet'])}>
                                  Show its wallet balance…
                                </MenuItem>
                              )}
                              {!extras.includes('assets') && (
                                <MenuItem icon={<KeyRound />} href={relink(['assets'])}>
                                  Weigh the ship it flies (assets)…
                                </MenuItem>
                              )}
                              {!extras.includes('structures') && (
                                <MenuItem icon={<Network />} href={relink(['structures'])}>
                                  Find jump bridges it may use (structures)…
                                </MenuItem>
                              )}
                              {extras.length > 0 && (
                                <MenuItem icon={<KeyRound />} href={relinkHref('/characters')}>
                                  Drop optional access…
                                </MenuItem>
                              )}
                            </>
                          )}
                          <MenuSeparator />
                          <MenuItem icon={<Unlink />} tone="danger" onSelect={() => setUnlinking(c)}>
                            Unlink…
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
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

/** Wanderer's Characters Tracking page: every map I can see, a switch per character. */
function TrackingCard({ me, tracking }: { me: MeDto; tracking: ReturnType<typeof useMyTracking> }) {
  const toast = useToast();
  const setTracking = useSetTracking();
  const characters = me.characters;
  const trackedOn = new Map(
    (tracking.data?.characters ?? []).map((l) => [l.characterId, new Set(l.trackedOn)]),
  );
  const maps = tracking.data?.maps ?? [];
  return (
    <Card>
      <CardHeader
        title="Tracking on maps"
        description="Which maps follow each character. Tracking needs member access to the map."
      />
      <CardBody flush>
        {tracking.isPending ? (
          <SkeletonRows count={3} avatar={false} />
        ) : tracking.isError ? (
          <ErrorState compact error={tracking.error} onRetry={() => void tracking.refetch()} />
        ) : maps.length === 0 || characters.length === 0 ? (
          <EmptyState
            compact
            title={characters.length === 0 ? 'No characters to track' : 'No maps yet'}
            description={
              characters.length === 0 ? 'Link an EVE character first.' : 'Maps you can open appear here.'
            }
          />
        ) : (
          <div className={styles.matrixScroll}>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th scope="col">Map</th>
                  {characters.map((c) => (
                    <th key={c.id} scope="col" className={styles.matrixCharacter}>
                      <Tooltip content={c.name}>
                        <span tabIndex={0} className={styles.matrixHead}>
                          <CharacterAvatar id={c.id} name={c.name} size={24} />
                          <span>{c.name}</span>
                        </span>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {maps.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">
                      <Link href={`/m/${m.slug}`} className={styles.mapLink}>
                        {m.name}
                      </Link>
                      {!m.canTrack && <span className={styles.viewOnly}>view only</span>}
                    </th>
                    {characters.map((c) => {
                      const on = trackedOn.get(c.id)?.has(m.id) ?? false;
                      const pending =
                        setTracking.isPending &&
                        setTracking.variables?.mapId === m.id &&
                        setTracking.variables.characterId === c.id;
                      return (
                        <td key={c.id}>
                          <Checkbox
                            className={styles.matrixCheck}
                            checked={on}
                            disabled={pending || (!on && (!m.canTrack || !c.tokenValid))}
                            onCheckedChange={(tracked) =>
                              setTracking.mutate(
                                { mapId: m.id, characterId: c.id, tracked },
                                {
                                  onError: (error) =>
                                    toast({
                                      title: 'Tracking did not change',
                                      description: errorText(error),
                                      tone: 'danger',
                                    }),
                                },
                              )
                            }
                            label={<span className="sr-only">{`Track ${c.name} on ${m.name}`}</span>}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
