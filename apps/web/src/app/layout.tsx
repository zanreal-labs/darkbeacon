import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '../styles.css';
import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { AnalyticsSlot } from '../analytics/AnalyticsSlot';
import { PwaSlot } from '../pwa/PwaSlot';
import { themeHeadScript, themeStyles } from '../theme/head';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Darkbeacon',
  description: 'Map your wormhole chain together, live.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
  },
  applicationName: 'Darkbeacon',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Edge to edge on phones (notches, the installed app's status bar); the shell keeps clear of
  // the safe areas.
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f14' },
  ],
};

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
        <Providers>
          {children}
          {/* The app install (manifest, service worker); `PWA=off` is read per request. */}
          <Suspense fallback={null}>
            <PwaSlot />
          </Suspense>
          {/* Google Analytics with its consent banner, only where the operator set GA_MEASUREMENT_ID. */}
          <Suspense fallback={null}>
            <AnalyticsSlot />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
