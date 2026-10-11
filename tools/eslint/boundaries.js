// Enforces the "Hexagonal rules" of docs/SPEC.md on import statements.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const modules = existsSync(resolve(root, 'packages/modules'))
  ? readdirSync(resolve(root, 'packages/modules'))
  : [];
const modulePackages = new Set(modules.map((m) => `@wormwright/${m}`));

// Frameworks and I/O libraries that domain/application code must not touch.
const IO =
  /^(@nestjs\/|fastify$|@fastify\/|kysely$|pg$|better-sqlite3$|ws$|react($|-)|@xyflow\/|@tanstack\/|vite$|node:)/;

const LAYERS = ['domain', 'application', 'ports'];
const MAY_IMPORT = {
  domain: ['domain'],
  ports: ['domain', 'ports'],
  application: ['domain', 'ports', 'application'],
};

function where(file) {
  const rel = relative(root, file).split(sep).join('/');
  let m = /^packages\/modules\/([^/]+)\/src\/(?:([^/]+)\/)?/.exec(rel);
  if (m) return { area: 'module', name: m[1], layer: LAYERS.includes(m[2]) ? m[2] : 'root' };
  m = /^(packages|plugins|apps)\/([^/]+)\//.exec(rel);
  if (m) return { area: m[1], name: m[2] };
  return { area: 'other' };
}

function packageOf(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function check(file, source) {
  const from = where(file);
  if (source.startsWith('.')) {
    const target = where(resolve(dirname(file), source));
    if (from.area === 'module') {
      if (target.area !== 'module')
        return 'a module must not reach outside its package with a relative import';
      if (target.name !== from.name)
        return `import @wormwright/${target.name} (its public API), not its files`;
      if (from.layer !== 'root' && !MAY_IMPORT[from.layer].includes(target.layer)) {
        return `${from.layer} must not import ${target.layer}`;
      }
      return null;
    }
    if (target.area !== from.area || target.name !== from.name)
      return 'use the package name, not a relative path';
    return null;
  }

  const pkg = packageOf(source);
  if (pkg.startsWith('@wormwright/') && /\/(src|dist)(\/|$)/.test(source)) {
    return 'import a package by its public entry, not its files';
  }
  switch (from.area) {
    case 'module':
      if (IO.test(source) || pkg === '@wormwright/db')
        return 'modules stay framework- and I/O-free; use a port';
      if (
        from.layer === 'domain' &&
        pkg.startsWith('@wormwright/') &&
        !['@wormwright/core', '@wormwright/shared'].includes(pkg)
      ) {
        return 'domain may only use @wormwright/core and @wormwright/shared';
      }
      if (pkg === `@wormwright/${from.name}`) return 'use a relative import inside the module';
      if (
        !modulePackages.has(pkg) &&
        pkg.startsWith('@wormwright/') &&
        !['@wormwright/core', '@wormwright/shared'].includes(pkg)
      ) {
        return `modules may not depend on ${pkg}`;
      }
      return null;
    case 'packages':
      if (from.name === 'core' && pkg.startsWith('@wormwright/')) return 'core depends on nothing internal';
      if (from.name === 'shared' && pkg.startsWith('@wormwright/') && pkg !== '@wormwright/core') {
        return 'shared may only use @wormwright/core';
      }
      return null;
    case 'plugins':
      if (
        pkg.startsWith('@wormwright/') &&
        !['@wormwright/plugin-sdk', '@wormwright/theme-sdk'].includes(pkg)
      ) {
        return 'plugins are built against @wormwright/plugin-sdk only';
      }
      return null;
    case 'apps':
      if (
        from.name === 'web' &&
        (pkg === '@wormwright/db' || pkg === '@wormwright/core' || modulePackages.has(pkg))
      ) {
        return 'the web app may use shared, theme-sdk and plugin-sdk only';
      }
      return null;
    default:
      return null;
  }
}

const rule = {
  meta: { type: 'problem', docs: { description: 'Hexagonal import boundaries' }, schema: [] },
  create(context) {
    const report = (node, source) => {
      if (typeof source !== 'string') return;
      const message = check(context.filename, source);
      if (message) context.report({ node, message: `${message} (${source})` });
    };
    const fromSource = (node) => node.source && report(node.source, node.source.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression: (node) => node.source.type === 'Literal' && report(node.source, node.source.value),
    };
  },
};

export default { meta: { name: 'wormwright' }, rules: { boundaries: rule } };
