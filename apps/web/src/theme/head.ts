import {
  builtInThemes,
  contrastTheme,
  darkTheme,
  lightTheme,
  systemThemesCss,
  THEME_COOKIE,
} from '@darkbeacon/theme-sdk';

/**
 * Cookie holding the theme someone picked (read before paint by the head script; not a secret).
 * The API sets it too when someone signs in, so a new browser starts with the account's theme.
 */
export { THEME_COOKIE };
/** The browser's copy of the same choice. */
export const THEME_STORAGE_KEY = 'dbk-theme-preference';
/** The key from before the rename to Darkbeacon; read once and moved, so nobody's choice is lost. */
export const LEGACY_THEME_STORAGE_KEY = 'ww-theme-preference';
/** CSS of the picked theme package, so it also applies before /api/themes answers. */
export const PACKAGE_CSS_STORAGE_KEY = 'dbk-theme-css';

/**
 * Every built-in theme as CSS custom properties. Without `data-theme` on <html> the page follows
 * `prefers-color-scheme` (and `prefers-contrast`) in CSS alone, so `system` is right on the very
 * first paint, without waiting for any script.
 */
export const themeStyles = systemThemesCss(
  { light: lightTheme, dark: darkTheme, contrast: contrastTheme },
  builtInThemes,
);

const builtInIds = builtInThemes.map((t) => t.id);

/**
 * Runs in <head> before the body is parsed (so before the first paint): applies an explicit
 * choice from the cookie, else from localStorage, as `data-theme`. `system` (or nothing saved)
 * leaves <html> alone, so the media queries above decide. A theme package applies its CSS saved
 * from the last visit; without it (a new browser, cleared storage) the built-in theme of the
 * package's colour scheme named in the cookie (`<id>|<built-in>`) stands in until the theme list
 * loads.
 */
export const themeHeadScript = `(function(){try{
var d=document.documentElement,b=${JSON.stringify(builtInIds)},p=null,f=null,s=null,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
if(m)p=decodeURIComponent(m[1]);
try{s=window.localStorage}catch(e){}
if(!p&&s)p=s.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||s.getItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
if(p&&p.indexOf("|")>=0){f=p.slice(p.indexOf("|")+1);p=p.slice(0,p.indexOf("|"))}
if(!p||p==="system")return;
if(b.indexOf(p)<0){var c=s&&s.getItem(${JSON.stringify(PACKAGE_CSS_STORAGE_KEY)});
if(!c||c.indexOf('[data-theme="'+p+'"]')<0){if(f&&b.indexOf(f)>=0)d.setAttribute("data-theme",f);return}
var e=document.createElement("style");e.id="dbk-package-themes";e.textContent=c;document.head.appendChild(e)}
d.setAttribute("data-theme",p)}catch(e){}})()`;
