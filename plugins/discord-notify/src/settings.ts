// Runs from DATA_DIR/plugins, where no packages are installed: SDK imports are types only, and
// requests are checked by hand here (the shared zod schemas describe the same shapes).
import type {
  DiscordMention,
  DiscordNotifyKind,
  DiscordNotifySettings,
  DiscordNotifyTargetInput,
  QuietHours,
  UpdateDiscordNotifyRequest,
} from '@darkbeacon/plugin-sdk';

export const KINDS: readonly DiscordNotifyKind[] = [
  'connections',
  'eol',
  'danger',
  'kills',
  'pings',
  'wayHome',
  'arrivals',
];
export const URGENT_KINDS: readonly DiscordNotifyKind[] = ['eol', 'danger', 'kills', 'pings'];

/** What a map starts with: the things a fleet acts on, quiet about the chatty ones. */
export const DEFAULT_SETTINGS: DiscordNotifySettings = {
  enabled: true,
  kinds: {
    connections: true,
    eol: true,
    danger: true,
    // Opt-in: busy chains near null-sec would post all day.
    kills: false,
    pings: true,
    wayHome: false,
    arrivals: false,
  },
  mention: { kind: 'none', roleId: null, kinds: ['pings'] },
  quietHours: { enabled: false, start: '23:00', end: '07:00', timeZone: 'UTC' },
};

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

const SNOWFLAKE = /^\d{1,20}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEBHOOK =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{1,20}\/[\w-]{20,200}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks a PUT body (the shape of `UpdateDiscordNotifyRequest`); throws RequestError. */
export function parseUpdate(body: unknown): UpdateDiscordNotifyRequest {
  if (!isObject(body)) throw new RequestError('Expected a JSON object');
  const update: UpdateDiscordNotifyRequest = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new RequestError('enabled must be true or false');
    update.enabled = body.enabled;
  }
  if (body.kinds !== undefined) {
    if (!isObject(body.kinds)) throw new RequestError('kinds must be an object');
    const kinds = {} as Record<DiscordNotifyKind, boolean>;
    for (const kind of KINDS) {
      const on = body.kinds[kind];
      if (typeof on !== 'boolean') throw new RequestError(`kinds.${kind} must be true or false`);
      kinds[kind] = on;
    }
    update.kinds = kinds;
  }
  if (body.mention !== undefined) update.mention = parseMention(body.mention);
  if (body.quietHours !== undefined) update.quietHours = parseQuietHours(body.quietHours);
  if (body.target !== undefined) update.target = body.target === null ? null : parseTarget(body.target);
  return update;
}

function parseMention(value: unknown): DiscordMention {
  if (!isObject(value)) throw new RequestError('mention must be an object');
  const kind = value.kind;
  if (kind !== 'none' && kind !== 'here' && kind !== 'role')
    throw new RequestError('mention.kind is invalid');
  const roleId = value.roleId ?? null;
  if (roleId !== null && (typeof roleId !== 'string' || !SNOWFLAKE.test(roleId))) {
    throw new RequestError('mention.roleId must be a Discord role');
  }
  if (kind === 'role' && roleId === null) throw new RequestError('Pick the role to mention');
  if (
    !Array.isArray(value.kinds) ||
    value.kinds.some((k) => !URGENT_KINDS.includes(k as DiscordNotifyKind))
  ) {
    throw new RequestError('mention.kinds lists what may mention');
  }
  return { kind, roleId, kinds: [...new Set(value.kinds)] as DiscordMention['kinds'] };
}

function parseQuietHours(value: unknown): QuietHours {
  if (!isObject(value)) throw new RequestError('quietHours must be an object');
  const { enabled, start, end, timeZone } = value;
  if (typeof enabled !== 'boolean') throw new RequestError('quietHours.enabled must be true or false');
  if (typeof start !== 'string' || !CLOCK.test(start))
    throw new RequestError('quietHours.start must be HH:MM');
  if (typeof end !== 'string' || !CLOCK.test(end)) throw new RequestError('quietHours.end must be HH:MM');
  if (typeof timeZone !== 'string' || !validTimeZone(timeZone)) {
    throw new RequestError('quietHours.timeZone must be a time zone such as UTC or Europe/Warsaw');
  }
  return { enabled, start, end, timeZone };
}

function parseTarget(value: unknown): DiscordNotifyTargetInput {
  if (!isObject(value)) throw new RequestError('target must be an object');
  if (value.kind === 'webhook') {
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!WEBHOOK.test(url)) {
      throw new RequestError('Paste the webhook URL from the channel settings (Integrations, Webhooks)');
    }
    return { kind: 'webhook', url };
  }
  if (value.kind === 'channel') {
    const { guildId, channelId } = value;
    if (typeof guildId !== 'string' || !SNOWFLAKE.test(guildId)) throw new RequestError('Pick a server');
    if (typeof channelId !== 'string' || !SNOWFLAKE.test(channelId)) throw new RequestError('Pick a channel');
    return { kind: 'channel', guildId, channelId };
  }
  throw new RequestError('target.kind must be webhook or channel');
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes after midnight of `at` in the time zone. */
function minutesIn(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

/** True inside quiet hours; a window may run over midnight (23:00 to 07:00). */
export function inQuietHours(quiet: QuietHours, at: number): boolean {
  if (!quiet.enabled) return false;
  const now = minutesIn(at, quiet.timeZone);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Stored settings over the defaults (new kinds added later start with their default). */
export function withDefaults(stored: Partial<DiscordNotifySettings> | null): DiscordNotifySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    kinds: { ...DEFAULT_SETTINGS.kinds, ...stored?.kinds },
    mention: { ...DEFAULT_SETTINGS.mention, ...stored?.mention },
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...stored?.quietHours },
  };
}
