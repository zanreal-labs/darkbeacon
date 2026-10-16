/**
 * In the installed app, a link to another site opens in the browser rather than inside the app's
 * window: true for an http(s) link off this origin that would otherwise replace the page. Sign-in
 * is untouched: it starts on this origin (`/api/auth/...`) and must finish in this window, where
 * the app keeps its cookies.
 */
export function opensInBrowser(
  link: { href: string; target: string; download?: boolean },
  origin: string,
): boolean {
  if (link.download || (link.target && link.target !== '_self')) return false;
  let url: URL;
  try {
    url = new URL(link.href, origin);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== origin;
}
