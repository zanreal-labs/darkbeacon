import { ValidationError } from '@darkbeacon/core';

/** Where a plugin or theme package comes from. */
export type PackageSource =
  | { kind: 'catalog'; name: string }
  | { kind: 'npm'; name: string; version: string | null }
  | { kind: 'upload'; data: Uint8Array };

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const NPM_VERSION = /^[0-9A-Za-z.+-]+$/;

/** `catalog:<name>`, or an npm name with an optional exact version or dist-tag after `@`. */
export function parsePackageSource(source: string): PackageSource {
  const text = source.trim();
  if (text.startsWith('catalog:')) {
    const name = text.slice('catalog:'.length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new ValidationError('Unknown catalogue entry');
    return { kind: 'catalog', name };
  }
  const at = text.indexOf('@', 1);
  const name = at === -1 ? text : text.slice(0, at);
  const version = at === -1 ? null : text.slice(at + 1);
  if (!NPM_NAME.test(name) || name.length > 214 || (version !== null && !NPM_VERSION.test(version))) {
    throw new ValidationError('Expected catalog:<name> or an npm package name, optionally with @version');
  }
  return { kind: 'npm', name, version };
}
