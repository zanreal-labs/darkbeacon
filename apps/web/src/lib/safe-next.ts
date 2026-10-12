/** Only same-site paths, so a crafted link cannot send people elsewhere after login. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
