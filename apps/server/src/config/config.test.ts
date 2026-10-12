import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseEnv } from './config.js';

describe('config', () => {
  it('applies defaults', () => {
    const config = parseEnv({});
    expect(config).toMatchObject({
      env: 'development',
      publicUrl: 'http://localhost:3000',
      port: 3000,
      dataDir: '/data',
      demoMode: false,
      deprecated: [],
      discord: null,
      eve: null,
      databaseUrl: undefined,
    });
  });

  it('reads oauth clients and treats empty values as unset', () => {
    const config = parseEnv({ DISCORD_CLIENT_ID: 'a', DISCORD_CLIENT_SECRET: 'b', EVE_CLIENT_ID: '' });
    expect(config.discord).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(config.eve).toBeNull();
  });

  it('rejects half-configured clients, bad urls and demo mode in production', () => {
    expect(() => parseEnv({ DISCORD_CLIENT_ID: 'a' })).toThrow(/DISCORD_CLIENT_SECRET/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
    expect(() => parseEnv({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(/ALLOW_DEMO_MODE/);
    expect(() => parseEnv({ NODE_ENV: 'production', DEV_LOGIN: 'true' })).toThrow(/ALLOW_DEMO_MODE/);
    expect(parseEnv({ NODE_ENV: 'production', DEMO_MODE: 'true', ALLOW_DEMO_MODE: 'true' }).demoMode).toBe(
      true,
    );
  });

  it('keeps DEV_LOGIN and ALLOW_DEV_LOGIN as deprecated aliases', () => {
    const config = parseEnv({ NODE_ENV: 'production', DEV_LOGIN: 'true', ALLOW_DEV_LOGIN: 'true' });
    expect(config.demoMode).toBe(true);
    expect(config.deprecated).toEqual(['DEV_LOGIN (use DEMO_MODE)', 'ALLOW_DEV_LOGIN (use ALLOW_DEMO_MODE)']);
    expect(parseEnv({ DEMO_MODE: 'true' })).toMatchObject({ demoMode: true, deprecated: [] });
  });

  it('generates and keeps a secret key in DATA_DIR', async () => {
    const dir = mkdtempSync(`${tmpdir()}/ww-config-`);
    const first = await loadConfig({ DATA_DIR: dir });
    const second = await loadConfig({ DATA_DIR: dir });
    expect(first.secretKey.length).toBeGreaterThanOrEqual(32);
    expect(second.secretKey).toBe(first.secretKey);
    expect(readFileSync(`${dir}/secret.key`, 'utf8').trim()).toBe(first.secretKey);
  });
});
