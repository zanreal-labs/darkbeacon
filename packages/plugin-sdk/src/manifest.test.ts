import { describe, expect, it } from 'vitest';
import { parseManifest, sdkCompatible } from './manifest.js';

const base = {
  id: 'discord-pings',
  name: 'Discord pings',
  version: '1.2.0',
  sdk: '^1.0',
  server: 'dist/server.js',
};

describe('plugin manifest', () => {
  it('accepts a valid manifest and fills defaults', () => {
    const result = parseManifest({ ...base, ports: ['notifier'] });
    expect(result.ok && result.manifest).toMatchObject({ ports: ['notifier'], events: [] });
  });

  it('rejects unknown ports, bad ids and escaping paths', () => {
    expect(parseManifest({ ...base, ports: ['database'] }).ok).toBe(false);
    expect(parseManifest({ ...base, id: 'Bad Id' }).ok).toBe(false);
    expect(parseManifest({ ...base, server: '../evil.js' }).ok).toBe(false);
  });

  it('needs an entry point and a compatible sdk', () => {
    expect(parseManifest({ ...base, server: undefined })).toEqual({
      ok: false,
      errors: ['manifest: needs a server or a web entry'],
    });
    expect(parseManifest({ ...base, sdk: '^2.0' }).ok).toBe(false);
    expect(sdkCompatible('1.x')).toBe(true);
  });

  it('only runs migrations for plugins that ask for the database', () => {
    expect(parseManifest({ ...base, migrations: 'migrations' })).toEqual({
      ok: false,
      errors: ['migrations: a plugin with migrations needs the db port'],
    });
    expect(parseManifest({ ...base, ports: ['db'], migrations: 'migrations' }).ok).toBe(true);
  });
});
