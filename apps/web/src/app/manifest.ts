import type { MetadataRoute } from 'next';

/** The web app manifest (`/manifest.webmanifest`), static. Colours are the dark theme's background. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Darkbeacon',
    short_name: 'Darkbeacon',
    description: 'Map your wormhole chain together, live.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0d0f14',
    theme_color: '#0d0f14',
    icons: [
      { src: '/icons/mark.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
