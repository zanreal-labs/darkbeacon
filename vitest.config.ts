import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/** Maps every workspace export to its `source` file, so tests run on TypeScript without a build. */
function workspaceAliases() {
  const dirs = ['packages', 'packages/modules', 'apps', 'plugins'].flatMap((parent) =>
    existsSync(join(root, parent)) ? readdirSync(join(root, parent)).map((d) => join(root, parent, d)) : [],
  );
  const aliases: { find: RegExp; replacement: string }[] = [];
  for (const dir of dirs) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      name: string;
      exports?: Record<string, { source?: string }>;
    };
    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      if (!target.source) continue;
      const name = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      aliases.push({
        find: new RegExp(`^${name.replace('/', '\\/')}$`),
        replacement: resolve(dir, target.source),
      });
    }
  }
  return aliases;
}

export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    globalSetup: ['./tools/vitest/global-setup.ts'],
    include: ['{apps,packages,plugins}/**/src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
