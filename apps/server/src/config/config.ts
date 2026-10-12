import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    SECRET_KEY: z.string().min(32, 'must be at least 32 characters').optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    EVE_CLIENT_ID: z.string().optional(),
    EVE_CLIENT_SECRET: z.string().optional(),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL; leave it empty to use SQLite')
      .optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATA_DIR: z.string().min(1).default('/data'),
    DEMO_MODE: flag,
    ALLOW_DEMO_MODE: flag,
    /** Deprecated aliases of DEMO_MODE and ALLOW_DEMO_MODE. */
    DEV_LOGIN: flag,
    ALLOW_DEV_LOGIN: flag,
  })
  .superRefine((env, ctx) => {
    for (const [id, secret] of [
      ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
      ['EVE_CLIENT_ID', 'EVE_CLIENT_SECRET'],
    ] as const) {
      if (!env[id] !== !env[secret]) {
        ctx.addIssue({
          code: 'custom',
          path: [env[id] ? secret : id],
          message: `set both ${id} and ${secret}`,
        });
      }
    }
    const demo = env.DEMO_MODE || env.DEV_LOGIN;
    if (demo && env.NODE_ENV === 'production' && !(env.ALLOW_DEMO_MODE || env.ALLOW_DEV_LOGIN)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.DEMO_MODE ? 'DEMO_MODE' : 'DEV_LOGIN'],
        message: 'refused in production; set ALLOW_DEMO_MODE=true if you really mean it',
      });
    }
  });

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  /** Origin the instance is reached at, without trailing slash. OAuth redirects are built from it. */
  publicUrl: string;
  /** Root secret: session signing and EVE token encryption keys are derived from it. */
  secretKey: string;
  /** Null when Discord login is not configured. */
  discord: OAuthClient | null;
  /** Null when EVE SSO is not configured. */
  eve: OAuthClient | null;
  /** Postgres URL, or undefined for SQLite at `<dataDir>/app.db`. */
  databaseUrl: string | undefined;
  port: number;
  dataDir: string;
  /**
   * Demo mode: unauthenticated visits are signed in as a demo account and a demo map is seeded.
   * Anyone who can reach the instance gets in, so it is refused in production unless allowed.
   */
  demoMode: boolean;
  /** Deprecated environment variables that were used (to warn about at startup). */
  deprecated: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Parses the environment. Throws ConfigError listing every problem. */
export function parseEnv(
  env: NodeJS.ProcessEnv,
): Omit<AppConfig, 'secretKey'> & { secretKey: string | undefined } {
  // Treat `KEY=` lines from .env files as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;
  const client = (id?: string, secret?: string) =>
    id && secret ? { clientId: id, clientSecret: secret } : null;
  return {
    env: e.NODE_ENV,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    secretKey: e.SECRET_KEY,
    discord: client(e.DISCORD_CLIENT_ID, e.DISCORD_CLIENT_SECRET),
    eve: client(e.EVE_CLIENT_ID, e.EVE_CLIENT_SECRET),
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    dataDir: e.DATA_DIR,
    demoMode: e.DEMO_MODE || e.DEV_LOGIN,
    deprecated: [
      ...(cleaned.DEV_LOGIN !== undefined ? ['DEV_LOGIN (use DEMO_MODE)'] : []),
      ...(cleaned.ALLOW_DEV_LOGIN !== undefined ? ['ALLOW_DEV_LOGIN (use ALLOW_DEMO_MODE)'] : []),
    ],
  };
}

/**
 * Full config. Without SECRET_KEY a random key is generated once and kept in
 * `<DATA_DIR>/secret.key`, so a plain `docker run` works; set it explicitly to manage it yourself.
 */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const config = parseEnv(env);
  return { ...config, secretKey: config.secretKey ?? (await ensureSecretKey(config.dataDir)) };
}

async function ensureSecretKey(dataDir: string): Promise<string> {
  const file = join(dataDir, 'secret.key');
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const key = randomBytes(32).toString('base64url');
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
  return key;
}
