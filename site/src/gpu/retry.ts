/**
 * A dynamic import that survives one failed chunk load.
 *
 * Chunks go missing for ordinary reasons: a deploy replaced them while the page was open, a
 * flaky connection dropped the request, a dev server re-optimised its dependencies. Browsers
 * remember a failed module URL for the life of the page, so the retry asks for the same file
 * with a cache-busting query, which is a different module as far as the browser is concerned.
 * The failed URL comes from the error message (Chromium and Firefox name it); where it does not,
 * the original error stands and the caller falls back.
 */
export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const url = String((error as Error)?.message ?? '').match(/(https?:\/\/\S+?\.(?:js|ts|mjs))(?:\?\S*)?\b/)?.[1];
    if (!url) throw error;
    const separator = url.includes('?') ? '&' : '?';
    return (await import(/* @vite-ignore */ `${url}${separator}retry=${Date.now()}`)) as T;
  }
}
