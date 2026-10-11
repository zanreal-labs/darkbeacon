import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// The API server during development (same container); override with API_URL.
const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Workspace packages are consumed from source.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    host: true,
    port: 5173,
    // `vite --mode mock` mocks the API in the page, so nothing is proxied.
    proxy:
      mode === 'mock'
        ? undefined
        : {
            '/api': { target: api, changeOrigin: false },
            '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
          },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
}));
