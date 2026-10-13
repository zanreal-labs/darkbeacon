import { DEFAULT_SUPPORT_HUB_URL, isSupportOrigin, type SupportBackend } from '@darkbeacon/shared';
import { parseSurveyRef, type SurveysConfig } from '@darkbeacon/support';
import type { OAuthClient } from '../../config/config.js';

export const DEFAULT_SUPPORT_POSTHOG_HOST = 'https://eu.i.posthog.com';

export interface SupportHubSettings {
  backend: SupportBackend;
  /** EVE SSO client of the hub's sign-in: SUPPORT_EVE_CLIENT_* or the instance's own. */
  eve: OAuthClient;
  posthog: { host: string; publicToken: string; secretKey: string } | null;
  /** PostHog surveys for feedback (PostHog desk only; the local desk keeps feedback itself). */
  surveys: { host: string; projectKey: string; surveys: SurveysConfig } | null;
  /** Shared secret of the PostHog workflow webhook; null: the webhook is off. */
  webhookSecret: string | null;
}

export interface SupportSettings {
  /** Null: this instance is not a hub. */
  hub: SupportHubSettings | null;
  /** Where this instance's help menu sends people (an origin), or null when turned off. */
  hubUrl: string | null;
  /** Why something asked for in the environment is not on (logged at start). */
  problems: string[];
}

const ON = new Set(['on', 'true', '1', 'yes']);
const OFF = new Set(['off', 'false', '0', 'no', 'none']);

/**
 * Support's own environment, read here so the module comes and goes without the core
 * configuration knowing about it (see docs/support.md):
 *
 * - every instance: SUPPORT_HUB_URL (default the maintainers' hub; `off` hides the entries);
 * - a hub: SUPPORT_HUB=on, SUPPORT_BACKEND (`posthog` or `local`), EVE SSO (the instance's or
 *   SUPPORT_EVE_CLIENT_ID/SECRET) and, for PostHog, SUPPORT_POSTHOG_HOST, SUPPORT_PUBLIC_TOKEN,
 *   SUPPORT_SECRET_KEY, SUPPORT_SURVEYS_KEY, SUPPORT_SURVEY_QUICK, SUPPORT_SURVEY_FEATURE and
 *   optionally SUPPORT_WEBHOOK_SECRET.
 */
export function supportSettings(
  env: NodeJS.ProcessEnv,
  instance: { publicUrl: string; eve: OAuthClient | null },
): SupportSettings {
  const problems: string[] = [];
  const read = (name: string) => env[name]?.trim() || undefined;
  const publicOrigin = new URL(instance.publicUrl).origin;

  let hub: SupportHubSettings | null = null;
  if (ON.has((read('SUPPORT_HUB') ?? 'off').toLowerCase())) hub = hubSettings(read, instance, problems);

  let hubUrl: string | null;
  const rawUrl = read('SUPPORT_HUB_URL');
  if (rawUrl && OFF.has(rawUrl.toLowerCase())) hubUrl = null;
  else if (rawUrl) {
    hubUrl = originOf(rawUrl);
    if (!hubUrl) {
      problems.push(`SUPPORT_HUB_URL is not an https address (${rawUrl}); support entries are off`);
    }
  } else hubUrl = hub ? publicOrigin : DEFAULT_SUPPORT_HUB_URL;

  return { hub, hubUrl, problems };
}

function hubSettings(
  read: (name: string) => string | undefined,
  instance: { eve: OAuthClient | null },
  problems: string[],
): SupportHubSettings | null {
  const backendRaw = (read('SUPPORT_BACKEND') ?? 'posthog').toLowerCase();
  if (backendRaw !== 'posthog' && backendRaw !== 'local') {
    problems.push(`SUPPORT_BACKEND must be posthog or local (got ${backendRaw}); the support hub is off`);
    return null;
  }
  const backend: SupportBackend = backendRaw;
  const eveId = read('SUPPORT_EVE_CLIENT_ID');
  const eveSecret = read('SUPPORT_EVE_CLIENT_SECRET');
  if (!eveId !== !eveSecret) {
    problems.push('set both SUPPORT_EVE_CLIENT_ID and SUPPORT_EVE_CLIENT_SECRET; the support hub is off');
    return null;
  }
  const eve = eveId && eveSecret ? { clientId: eveId, clientSecret: eveSecret } : instance.eve;
  if (!eve) {
    problems.push(
      'the support hub signs pilots in with EVE SSO: set EVE_CLIENT_ID/SECRET or SUPPORT_EVE_CLIENT_ID/SECRET',
    );
    return null;
  }
  const webhookSecret = read('SUPPORT_WEBHOOK_SECRET') ?? null;
  if (webhookSecret !== null && webhookSecret.length < 24) {
    problems.push('SUPPORT_WEBHOOK_SECRET is shorter than 24 characters; the webhook is off');
  }
  const webhook = webhookSecret !== null && webhookSecret.length >= 24 ? webhookSecret : null;
  if (backend === 'local') return { backend, eve, posthog: null, surveys: null, webhookSecret: webhook };

  const host = originOf(read('SUPPORT_POSTHOG_HOST') ?? DEFAULT_SUPPORT_POSTHOG_HOST, true);
  const publicToken = read('SUPPORT_PUBLIC_TOKEN');
  const secretKey = read('SUPPORT_SECRET_KEY');
  if (!host || !publicToken || !secretKey) {
    problems.push(
      'SUPPORT_BACKEND=posthog needs SUPPORT_PUBLIC_TOKEN and SUPPORT_SECRET_KEY (and a valid SUPPORT_POSTHOG_HOST); the support hub is off',
    );
    return null;
  }
  let surveys: SupportHubSettings['surveys'] = null;
  const projectKey = read('SUPPORT_SURVEYS_KEY');
  try {
    const config: SurveysConfig = {
      quick: parseSurveyRef(read('SUPPORT_SURVEY_QUICK'), 'quick'),
      feature: parseSurveyRef(read('SUPPORT_SURVEY_FEATURE'), 'feature'),
    };
    if (projectKey && (config.quick || config.feature)) surveys = { host, projectKey, surveys: config };
    else if (projectKey || config.quick || config.feature)
      problems.push(
        'feedback needs SUPPORT_SURVEYS_KEY and SUPPORT_SURVEY_QUICK or SUPPORT_SURVEY_FEATURE; feedback is off',
      );
  } catch (error) {
    problems.push(
      `SUPPORT_SURVEY_*: ${error instanceof Error ? error.message : String(error)}; feedback is off`,
    );
  }
  return { backend, eve, posthog: { host, publicToken, secretKey }, surveys, webhookSecret: webhook };
}

/** The origin of a URL when it is one support may use (https, or loopback for development). */
function originOf(value: string, allowAnyHttps = false): string | null {
  try {
    const origin = new URL(value).origin;
    if (allowAnyHttps) return origin.startsWith('https://') || isSupportOrigin(origin) ? origin : null;
    return isSupportOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}
