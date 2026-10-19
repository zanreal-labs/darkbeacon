import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import sitemap from '@astrojs/sitemap';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import { defineConfig } from 'astro/config';
import llms from './integrations/llms';
import { SITE_URL } from './src/config';

const dev = process.argv.includes('dev');

// Sitemap lastmod: the last commit that changed the page's own file, when git history is there
// (a shallow clone may not reach it; then the entry simply has no lastmod).
const lastmod = (url: string): string | undefined => {
  const path = new URL(url).pathname.replace(/^\/$/, '/index');
  const file = `src/pages${path}.astro`;
  if (!existsSync(file)) return undefined;
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
};

// Static output: `npm run build` writes plain files to dist/. Vercel detects Astro and serves them.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  // Pages are files (sponsor.html) served without extension by Vercel's cleanUrls, so canonical,
  // Open Graph and sitemap URLs are /sponsor, exactly what is served.
  trailingSlash: 'never',
  // llms: the Markdown twins of every page, /llms.txt and /llms-full.txt (integrations/llms.ts).
  integrations: [
    sitemap({
      filter: (page) => !/\/404\/?$/.test(new URL(page).pathname),
      serialize: (item) => ({ ...item, lastmod: lastmod(item.url) }),
    }),
    llms(),
  ],
  build: { inlineStylesheets: 'always', format: 'file' },
  devToolbar: { enabled: false },
  vite: {
    // `.wgsl` files are modules: they import and export like TypeScript and compile to the shader
    // source vgpu takes. Minified in production builds.
    plugins: [wgslVitePlugin({ minify: !dev })],
    // The dev server runs in a container over a bind mount from macOS, where file events do not
    // reach it; polling is what makes hot reload work there. Dev only.
    server: dev ? { watch: { usePolling: true, interval: 300 } } : {},
  },
});
