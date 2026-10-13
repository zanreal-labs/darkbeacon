'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Plus, Settings, Sparkles } from 'lucide-react';
import type { MeDto } from '@darkbeacon/shared';
import { accountImage } from '../lib/account';
import { relinkHref } from '../lib/scope-health';
import { useLogout, useMe, useProviders } from '../lib/session';
import {
  Avatar,
  Badge,
  CharacterAvatar,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../ui';
import { SupportMenuItems } from './HelpMenu';
import styles from './AppShell.module.css';

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', user: 'Member' } as const;

/** Links a character (again) through EVE SSO; see `relinkHref`, which also keeps extras. */
export function eveLinkHref(returnTo = '/characters'): string {
  return relinkHref(returnTo);
}

/** Avatar button with the account, its EVE characters and sign out. `me` is the server's copy. */
export function AccountMenu({ me: rendered }: { me: MeDto }) {
  const router = useRouter();
  const logout = useLogout();
  const providers = useProviders();
  const me = useMe().data ?? rendered;
  const { account, characters } = me;
  const main = characters.find((c) => c.id === account.mainCharacterId);
  return (
    <Menu>
      <MenuTrigger className={styles.accountTrigger} aria-label={`Account: ${account.name}`}>
        <Avatar src={accountImage(me)} name={account.name} size={28} />
      </MenuTrigger>
      <MenuContent className={styles.accountMenu}>
        <div className={styles.accountHeader}>
          <Avatar src={accountImage(me)} name={account.name} size={36} />
          <div className={styles.accountHeading}>
            <strong>{account.name}</strong>
            <span className="muted">
              {providers.data?.loginMethod === 'eve'
                ? 'EVE Online'
                : account.discordId
                  ? 'Discord'
                  : 'Local account'}{' '}
              · {ROLE_LABEL[account.instanceRole]}
            </span>
          </div>
        </div>
        <MenuSeparator />
        <MenuLabel>EVE characters</MenuLabel>
        <MenuGroup>
          {characters.length === 0 && <div className={styles.menuNote}>No characters linked yet.</div>}
          {characters.map((c) => (
            <MenuItem
              key={c.id}
              icon={<CharacterAvatar id={c.id} name={c.name} size={20} />}
              onSelect={() => router.push('/characters')}
            >
              <span className={styles.menuCharacter}>
                {c.name}
                {c.id === main?.id && <Badge tone="accent">Main</Badge>}
                {!c.tokenValid && <Badge tone="danger">Re-link</Badge>}
                {c.tokenValid && (c.missingScopes?.length ?? 0) > 0 && <Badge tone="warning">Re-link</Badge>}
              </span>
            </MenuItem>
          ))}
          {providers.data?.eve && (
            <MenuItem icon={<Plus />} href={eveLinkHref()}>
              Link EVE character
            </MenuItem>
          )}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon={<Settings />} onSelect={() => router.push('/account')}>
          Account settings
        </MenuItem>
        <MenuItem icon={<Sparkles />} onSelect={() => router.push('/changelog')}>
          What&apos;s new
        </MenuItem>
        <SupportMenuItems />
        <MenuItem
          icon={<LogOut />}
          onSelect={() => logout.mutate(undefined, { onSuccess: () => router.replace('/login') })}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
