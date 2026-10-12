import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { nodeNameSizers } from './src/map/node-sizers';

/** The monorepo root: workspace packages live outside apps/web and must be traced into the build. */
const root = resolve(import.meta.dirname, '../..');

/** The longest system names of the universe dataset; every system node is as wide as they need. */
const universe = JSON.parse(readFileSync(resolve(root, 'packages/sde/data/universe.json'), 'utf8')) as {
  systems: { name: string }[];
};
const sizers = nodeNameSizers(universe.systems.map((s) => s.name));

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
  env: { DBK_NODE_NAME_SIZERS: JSON.stringify(sizers), DBK_BUILD_ID: buildId },
  generateBuildId: () => buildId,
  // The API server streams this app's answers through; anything in front of it must not buffer.
  headers: async () => [{ source: '/:path*{/}?', headers: [{ key: 'X-Accel-Buffering', value: 'no' }] }],
};

export default config;
