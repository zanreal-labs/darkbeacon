import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/** The monorepo root: workspace packages live outside apps/web and must be traced into the build. */
const root = resolve(import.meta.dirname, '../..');

/**
 * One id per build, shared by the pages and the server (which reads `.next/BUILD_ID`): a page
 * whose id differs from the server's is out of date and offers a reload.
 */
const buildId =
  process.env.DBK_BUILD_ID ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
  // OpenTelemetry (src/instrumentation.node.ts) loads exporters at runtime; keep it out of the bundle.
  serverExternalPackages: ['@opentelemetry/sdk-node', '@opentelemetry/instrumentation-undici'],
  env: { DBK_BUILD_ID: buildId },
  generateBuildId: () => buildId,
  // The API server streams this app's answers through; anything in front of it must not buffer.
  headers: async () => [{ source: '/:path*{/}?', headers: [{ key: 'X-Accel-Buffering', value: 'no' }] }],
};

export default config;
