import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/** The monorepo root: workspace packages live outside apps/web and must be traced into the build. */
const root = resolve(import.meta.dirname, '../..');

const config: NextConfig = {
  // Cache Components with Partial Prerendering and Partial Prefetching, as the Next.js 16 docs
  // recommend (https://nextjs.org/docs/app/getting-started/caching). See docs/decisions.md.
  cacheComponents: true,
  partialPrefetching: true,
  // A self-contained server (`.next/standalone`) that the API server starts next to itself.
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  // The API server streams this app's answers through; anything in front of it must not buffer.
  headers: async () => [{ source: '/:path*{/}?', headers: [{ key: 'X-Accel-Buffering', value: 'no' }] }],
};

export default config;
