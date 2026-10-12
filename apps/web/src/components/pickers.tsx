'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Hash, Megaphone } from 'lucide-react';
import {
  buildPath,
  routes,
  type AccountSummaryDto,
  type DiscordChannelDto,
  type DiscordGuildDto,
  type DiscordRoleDto,
  type EveEntityCategory,
  type EveEntityDto,
  type EveSearchResultDto,
} from '@darkbeacon/shared';
import { api } from '../lib/api';
import { hereForReturn } from '../lib/scope-health';
import { eveLinkHref } from '../shell/AccountMenu';
import { characterPortraitUrl, SearchPicker, Select, Skeleton, type PickerOption } from '../ui';
import styles from './pickers.module.css';

const IMAGES = 'https://images.evetech.net';

export function eveImage(category: EveEntityCategory, id: number): string {
  if (category === 'character') return characterPortraitUrl(id, 64);
  return `${IMAGES}/${category === 'corporation' ? 'corporations' : 'alliances'}/${id}/logo?size=64`;
}

export type EveOption = PickerOption & { entity: EveEntityDto };

export function eveOption(entity: EveEntityDto): EveOption {
  return {
    key: `${entity.category}:${entity.id}`,
    label: entity.name,
    detail: entity.ticker ? `[${entity.ticker}]` : null,
    imageUrl: eveImage(entity.category, entity.id),
    shape: entity.category === 'character' ? 'circle' : 'rounded',
    entity,
  };
}

const NOUN: Record<EveEntityCategory, string> = {
  character: 'character',
  corporation: 'corporation',
  alliance: 'alliance',
};

/**
 * Characters, corporations or alliances by name: ESI search through one of your characters, or
 * the exact name when none of them may search (with a way to fix that).
 */
export function EvePicker({
  category,
  value,
  onChange,
  disabled,
}: {
  category: EveEntityCategory;
  value: EveOption | null;
  onChange(value: EveOption | null): void;
  disabled?: boolean;
}) {
  return (
    <SearchPicker<EveOption>
      value={value}
      onChange={onChange}
      cacheKey={['eve', category]}
      disabled={disabled}
      placeholder={`Search ${/^[aeiou]/.test(NOUN[category]) ? 'an' : 'a'} ${NOUN[category]} by name`}
      search={async (q) => {
        const found = await api<EveSearchResultDto>(
          `${routes.eve.search.path}?${new URLSearchParams({ category, q })}`,
        );
        return {
          options: found.results.map(eveOption),
          note: found.relinkToSearch ? (
            <>
              Only exact names match. <a href={eveLinkHref(hereForReturn())}>Link a character again</a> to
              search by part of a name.
            </>
          ) : found.mode === 'exact' && q.length < 3 ? (
            'Type at least 3 letters to search; shorter text must be the exact name.'
          ) : null,
        };
      }}
      empty={`No ${NOUN[category]} with that name`}
    />
  );
}

export type AccountOption = PickerOption & { account: AccountSummaryDto };

export function accountOption(account: AccountSummaryDto): AccountOption {
  return {
    key: account.id,
    label: account.name,
    imageUrl:
      account.avatarUrl ??
      (account.mainCharacterId ? characterPortraitUrl(account.mainCharacterId, 64) : null),
    account,
  };
}

/** People who signed in to this instance, by name. */
export function AccountPicker({
  value,
  onChange,
}: {
  value: AccountOption | null;
  onChange(value: AccountOption | null): void;
}) {
  return (
    <SearchPicker<AccountOption>
      value={value}
      onChange={onChange}
      cacheKey={['accounts']}
      placeholder="Search someone by name"
      search={async (q) => ({
        options: (
          await api<AccountSummaryDto[]>(`${routes.accounts.search.path}?${new URLSearchParams({ q })}`)
        ).map(accountOption),
      })}
      empty="Nobody with that name has signed in yet"
    />
  );
}

export const discordKeys = {
  guilds: ['discord-guilds'] as const,
  roles: (guildId: string) => ['discord-roles', guildId] as const,
  channels: (guildId: string) => ['discord-channels', guildId] as const,
};

export function useDiscordGuilds(enabled = true) {
  return useQuery({
    queryKey: discordKeys.guilds,
    queryFn: () => api<DiscordGuildDto[]>(routes.discord.guilds.path),
    enabled,
    staleTime: 60_000,
  });
}

export function useDiscordRoles(guildId: string | null) {
  return useQuery({
    queryKey: discordKeys.roles(guildId ?? ''),
    queryFn: () => api<DiscordRoleDto[]>(buildPath(routes.discord.roles.path, { guildId: guildId! })),
    enabled: guildId !== null,
    staleTime: 60_000,
  });
}

export function useDiscordChannels(guildId: string | null) {
  return useQuery({
    queryKey: discordKeys.channels(guildId ?? ''),
    queryFn: () => api<DiscordChannelDto[]>(buildPath(routes.discord.channels.path, { guildId: guildId! })),
    enabled: guildId !== null,
    staleTime: 60_000,
  });
}

/** A Discord server the bot is in. */
export function GuildSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange(guildId: string): void;
  disabled?: boolean;
}) {
  const guilds = useDiscordGuilds();
  if (guilds.isPending) return <Skeleton height={32} radius={6} />;
  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled || !guilds.data?.length}
      placeholder={guilds.data?.length ? 'Pick a server' : 'The bot is in no server yet'}
      options={(guilds.data ?? []).map((g) => ({
        value: g.id,
        label: g.name,
        icon: g.iconUrl ? <img src={g.iconUrl} alt="" className={styles.guildIcon} /> : undefined,
      }))}
    />
  );
}

/** A role on a server, with its colour; integration roles cannot be handed out. */
export function RoleSelect({
  guildId,
  value,
  onChange,
  disabled,
}: {
  guildId: string | null;
  value: string | null;
  onChange(roleId: string): void;
  disabled?: boolean;
}) {
  const roles = useDiscordRoles(guildId);
  if (guildId && roles.isPending) return <Skeleton height={32} radius={6} />;
  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled || !guildId}
      placeholder={guildId ? 'Pick a role' : 'Pick a server first'}
      options={(roles.data ?? [])
        .filter((r) => !r.managed)
        .map((r) => ({
          value: r.id,
          label: r.name,
          icon: (
            <span
              className={styles.roleDot}
              style={{ background: r.color ?? 'var(--dbk-color-text-subtle)' }}
            />
          ),
        }))}
    />
  );
}

/** A channel the bot can post in, grouped by its category in the label. */
export function ChannelSelect({
  guildId,
  value,
  onChange,
}: {
  guildId: string | null;
  value: string | null;
  onChange(channelId: string): void;
}) {
  const channels = useDiscordChannels(guildId);
  if (guildId && channels.isPending) return <Skeleton height={32} radius={6} />;
  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={!guildId || !channels.data?.length}
      placeholder={
        guildId
          ? channels.data?.length
            ? 'Pick a channel'
            : 'No channel the bot can see'
          : 'Pick a server first'
      }
      options={(channels.data ?? []).map((c) => ({
        value: c.id,
        label: c.category ? `${c.name} · ${c.category}` : c.name,
        icon: c.kind === 'announcement' ? <Megaphone /> : <Hash />,
      }))}
    />
  );
}

/** Where admins connect the bot, for hints next to lists that need it. */
export function BotHint({ admin }: { admin: boolean }) {
  return admin ? (
    <>
      <Link href="/admin">Connect a Discord bot</Link> in Admin to pick servers and roles from lists.
    </>
  ) : (
    'Ask an instance admin to connect a Discord bot, so servers and roles can be picked from lists.'
  );
}
