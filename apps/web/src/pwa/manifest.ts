import type { MetadataRoute } from 'next';

/** The dark theme's background (theme-sdk `color-bg`), behind the splash screen and the title bar. */
export const MANIFEST_BACKGROUND = '#0d0f14';

/**
 * The web app manifest (`/manifest.webmanifest`). Each instance is its own origin and serves its
 * own; instances have no display name of their own, so every one is "Darkbeacon".
 *
 * `display` is plain `standalone`: the top bar would need drag regions and the title bar's
 * insets for `window-controls-overlay`, and the OS title bar is fine next to the EVE client.
 */
export function buildManifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Darkbeacon',
    short_name: 'Darkbeacon',
    description: 'Map your wormhole chain together, live.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: MANIFEST_BACKGROUND,
    theme_color: MANIFEST_BACKGROUND,
    categories: ['games', 'utilities', 'navigation'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    // The wormhole types reference opens over any page and has no address of its own: no shortcut.
    shortcuts: [
      {
        name: 'Map',
        short_name: 'Map',
        description: 'Open your map',
        url: '/',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Jump planner',
        short_name: 'Jumps',
        description: 'Plan a capital jump route',
        url: '/jump',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
