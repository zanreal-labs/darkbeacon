import type { ThemeAdmin } from '@darkbeacon/plugins';
import { SYSTEM_THEME_ID, THEME_COOKIE, themeCookieValue } from '@darkbeacon/theme-sdk';
import type { RequestLike } from '../../platform/actor.js';
import { readCookie, serializeCookie } from '../identity/cookies.js';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The `dbk_theme` cookie the web app's head script reads before the first paint (the web app
 * writes the same cookie when someone picks a theme). Not httpOnly: it is no secret.
 */
export function themeCookie(
  themeId: string,
  packageScheme: 'light' | 'dark' | null,
  secure: boolean,
): string {
  return serializeCookie(THEME_COOKIE, themeCookieValue(themeId, packageScheme), {
    maxAgeSeconds: ONE_YEAR_SECONDS,
    secure,
    httpOnly: false,
  });
}

/**
 * The theme a new session starts with, so a browser that never saw this account paints its theme
 * at once: the account's own choice always, the instance default only when the browser has no
 * choice of its own saved (the browser's copy beats the default, as in the web app).
 */
export async function signInThemeCookies(
  themes: ThemeAdmin,
  accountId: string,
  request: RequestLike,
  secure: boolean,
): Promise<string[]> {
  const start = await themes.startingTheme(accountId);
  if (!start.own && (start.themeId === SYSTEM_THEME_ID || readCookie(request, THEME_COOKIE) !== null))
    return [];
  return [themeCookie(start.themeId, start.packageScheme, secure)];
}
