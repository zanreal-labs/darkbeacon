'use client';

import '@fontsource-variable/inter/wght.css';
import '../styles.css';
import { themeStyles } from '../theme/head';
import { ErrorState } from '../ui';

/**
 * The last resort, when even the root layout failed: a whole document of its own, in the design
 * system's look (built-in themes by the OS scheme), with a way to try again.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light dark" />
        <title>Something went wrong · Darkbeacon</title>
        <style id="dbk-themes" dangerouslySetInnerHTML={{ __html: themeStyles }} />
      </head>
      <body>
        <main
          style={{
            display: 'grid',
            placeItems: 'center',
            minHeight: '100dvh',
            padding: 'var(--dbk-space-4)',
          }}
        >
          <ErrorState title="Darkbeacon could not be loaded" error={error} onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
