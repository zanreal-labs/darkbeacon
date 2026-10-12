'use client';

import { useRouter } from 'next/navigation';
import { KeyRound, RefreshCw, TriangleAlert } from 'lucide-react';
import type { MeDto } from '@darkbeacon/shared';
import {
  charactersNeedingAttention,
  hereForReturn,
  relinkHref,
  type CharacterAttention,
} from '../lib/scope-health';
import { useMe, useProviders } from '../lib/session';
import { CharacterAvatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui';
import styles from './StatusBits.module.css';

/**
 * The one place every page says a character needs linking again: its sign-in expired, or
 * Darkbeacon asks for scopes its grant lacks (contacts for standings, structures for bridges...).
 * A quiet chip in the top bar; its menu names each character, what it lacks and links it again.
 */
export function ScopeNotice({ me: rendered }: { me: MeDto }) {
  const me = useMe().data ?? rendered;
  const eve = useProviders().data?.eve ?? false;
  const router = useRouter();
  const attention = charactersNeedingAttention(me);
  if (attention.length === 0) return null;
  const expired = attention.some((a) => a.expired);
  const label =
    attention.length === 1
      ? `${attention[0]!.character.name} needs linking again`
      : `${attention.length} characters need linking again`;
  return (
    <Menu>
      <MenuTrigger className={styles.notice} data-tone={expired ? 'danger' : 'warning'} aria-label={label}>
        <TriangleAlert aria-hidden />
        <span className={styles.noticeLabel}>Re-link {attention.length}</span>
      </MenuTrigger>
      <MenuContent align="end" className={styles.noticeMenu}>
        <MenuLabel>{label}</MenuLabel>
        {attention.map((a) => (
          <AttentionItem key={a.character.id} attention={a} canLink={eve} />
        ))}
        <MenuSeparator />
        <MenuItem icon={<KeyRound />} onSelect={() => router.push('/characters')}>
          Characters and their scopes
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function AttentionItem({ attention, canLink }: { attention: CharacterAttention; canLink: boolean }) {
  const { character } = attention;
  const body = (
    <span className={styles.attention}>
      <strong>{character.name}</strong>
      <span className={styles.attentionWhy}>
        {attention.expired ? 'Sign-in expired' : `Missing ${attention.missing.join(', ')}`}
      </span>
      {canLink && (
        <span className={styles.attentionAction}>
          <RefreshCw aria-hidden /> Link again
        </span>
      )}
    </span>
  );
  if (!canLink)
    return (
      <MenuItem icon={<CharacterAvatar id={character.id} name={character.name} size={20} />} disabled>
        {body}
      </MenuItem>
    );
  return (
    <MenuItem
      icon={<CharacterAvatar id={character.id} name={character.name} size={20} />}
      href={relinkHref(hereForReturn(), character.extras ?? [])}
    >
      {body}
    </MenuItem>
  );
}
