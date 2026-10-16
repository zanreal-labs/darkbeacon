import {
  eveScopeLabel,
  routes,
  type CharacterDto,
  type MeDto,
  type OptionalEveScope,
} from '@darkbeacon/shared';

/** What is wrong with a character's EVE grant, if anything. */
export interface CharacterAttention {
  character: CharacterDto;
  /** The sign-in no longer works: tracking and everything else stopped. */
  expired: boolean;
  /** Scopes Darkbeacon asks for that the grant lacks, in words. */
  missing: string[];
}

/** Characters whose grant needs attention: expired first, then those missing scopes. */
export function charactersNeedingAttention(me: MeDto | null | undefined): CharacterAttention[] {
  return (me?.characters ?? [])
    .map((character) => ({
      character,
      expired: !character.tokenValid,
      missing: character.tokenValid ? (character.missingScopes ?? []).map(eveScopeLabel) : [],
    }))
    .filter((a) => a.expired || a.missing.length > 0)
    .sort(
      (a, b) => Number(b.expired) - Number(a.expired) || a.character.name.localeCompare(b.character.name),
    );
}

/** One line saying what a character's grant lacks. */
export function attentionText(a: CharacterAttention): string {
  if (a.expired) return 'Sign-in expired: tracking and everything else stopped.';
  return `Missing: ${a.missing.join(', ')}.`;
}

/**
 * Where linking a character (again) starts. Extras the character already granted are asked for
 * again, so linking it anew never drops them.
 */
export function relinkHref(returnTo = '/account', extras: readonly OptionalEveScope[] = []): string {
  const params = new URLSearchParams({ returnTo });
  if (extras.length > 0) params.set('extras', extras.join(','));
  return `${routes.auth.eveLogin.path}?${params}`;
}

/** The page the browser is on, for coming back after EVE SSO. */
export function hereForReturn(): string {
  if (typeof window === 'undefined') return '/account';
  return `${window.location.pathname}${window.location.search}`;
}
