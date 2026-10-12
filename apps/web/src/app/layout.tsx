import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '../styles.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { themeHeadScript, themeStyles } from '../theme/head';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Darkbeacon',
  description: 'Map your wormhole chain together, live.',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

/**
 * The document: theme tokens and the theme head script come first, so the first paint already
 * has the right colours (`data-theme` is set by that script before React runs, hence
 * suppressHydrationWarning on <html>).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style id="dbk-themes" dangerouslySetInnerHTML={{ __html: themeStyles }} />
        <script dangerouslySetInnerHTML={{ __html: themeHeadScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
