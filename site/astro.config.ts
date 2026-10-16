import sitemap from '@astrojs/sitemap';
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';
import { defineConfig } from 'astro/config';
import { SITE_URL } from './src/config';

const dev = process.argv.includes('dev');

// Static output: `npm run build` writes plain files to dist/. Vercel detects Astro and serves them.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'always' },
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
