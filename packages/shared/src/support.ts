import { z } from 'zod';
import { TelemetryPage, TelemetrySection, TelemetryThemeId, ViewportBucket } from './telemetry.js';

/**
 * Support tickets and feedback (see docs/support.md). Every instance can open the support hub
 * (by default the maintainers' instance) in a popup; pilots sign in to the hub as to any
 * Darkbeacon instance, and the hub keeps tickets per EVE character of their account in PostHog
 * Support or in its own database. None of this goes through anonymous telemetry: tickets carry
 * what a person typed and are tied to one of their characters.
 */

/** The maintainers' hub. `SUPPORT_HUB_URL=off` turns the entries off, another URL picks another hub. */
export const DEFAULT_SUPPORT_HUB_URL = 'https://darkbeacon.zanreal.app';

export const SUPPORT_CATEGORIES = ['bug', 'support', 'question'] as const;
export const SupportCategory = z.enum(SUPPORT_CATEGORIES);
export type SupportCategory = z.infer<typeof SupportCategory>;

/** PostHog Support's ticket states; the hub's own store uses the same ones. */
export const SUPPORT_STATUSES = ['new', 'open', 'pending', 'on_hold', 'resolved'] as const;
export const SupportTicketStatus = z.enum(SUPPORT_STATUSES);
export type SupportTicketStatus = z.infer<typeof SupportTicketStatus>;

export const SUPPORT_PRIORITIES = ['low', 'medium', 'high'] as const;
export const SupportPriority = z.enum(SUPPORT_PRIORITIES);
export type SupportPriority = z.infer<typeof SupportPriority>;

export const SupportBackend = z.enum(['posthog', 'local']);
export type SupportBackend = z.infer<typeof SupportBackend>;

/** The longest message a ticket or a reply may carry (PostHog takes up to 10 000 characters). */
export const SUPPORT_MESSAGE_MAX = 5000;
export const SUPPORT_FEEDBACK_MAX = 2000;
/** Client errors sent with a ticket: the last few, each cut short. */
export const SUPPORT_ERRORS_MAX = 5;
export const SUPPORT_ERROR_LENGTH = 300;

export const SupportBrowser = z.enum(['chrome', 'firefox', 'safari', 'edge', 'opera', 'other']);
export type SupportBrowser = z.infer<typeof SupportBrowser>;
export const SupportOs = z.enum(['windows', 'macos', 'linux', 'ios', 'android', 'chromeos', 'other']);
export type SupportOs = z.infer<typeof SupportOs>;
/** Where in the app the ticket was started: a route kind, never a map address. */
export const SupportPage = z.enum([...TelemetryPage.options, 'other']);
export type SupportPage = z.infer<typeof SupportPage>;

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;
const count = z.number().int().min(0).max(1_000_000);

/**
 * Everything a ticket may carry besides the message: a closed list of fields, each an enum, a
 * version, a boolean or a scrubbed error line. The last two are opt-in (unticked by default).
 * Never: map, system or signature data, map addresses, notes, the instance id, IPs or emails.
 */
export const SupportContext = z.strictObject({
  appVersion: z
    .string()
    .max(32)
    .regex(/^[0-9A-Za-z.+-]+$/)
    .optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  db: z.enum(['sqlite', 'postgres']).optional(),
  login: z.enum(['discord', 'eve']).optional(),
  page: SupportPage.optional(),
  section: TelemetrySection.optional(),
  viewport: ViewportBucket.optional(),
  browser: SupportBrowser.optional(),
  os: SupportOs.optional(),
  locale: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
    .optional(),
  theme: TelemetryThemeId.optional(),
  scheme: z.enum(['light', 'dark']).optional(),
  demo: z.boolean().optional(),
  /** The last client errors, scrubbed (`scrubClientError`). */
  errors: z.array(z.string().max(SUPPORT_ERROR_LENGTH)).max(SUPPORT_ERRORS_MAX).optional(),
  /** Opt-in: the address the instance is reached at (host only). */
  instanceHost: z.string().max(260).regex(HOSTNAME).optional(),
  /** Opt-in: how big the open map is, as counts. */
  mapCounts: z.strictObject({ systems: count, connections: count, signatures: count }).optional(),
});
export type SupportContext = z.infer<typeof SupportContext>;
export type SupportContextKey = keyof SupportContext;

/** Fields of the context that are only sent when the person ticks them. */
export const SUPPORT_OPT_IN_KEYS = [
  'instanceHost',
  'mapCounts',
] as const satisfies readonly SupportContextKey[];

const CONTEXT_KEYS = Object.keys(SupportContext.shape) as SupportContextKey[];

/**
 * The context as the hub accepts it from another page: each known field kept when it is valid,
 * anything else dropped (the opener is not trusted). Error lines are scrubbed again.
 */
export function sanitizeSupportContext(raw: unknown): SupportContext {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of CONTEXT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const prepared =
      key === 'errors' && Array.isArray(value)
        ? value
            .filter((v): v is string => typeof v === 'string')
            .slice(-SUPPORT_ERRORS_MAX)
            .map(scrubClientError)
            .filter(Boolean)
        : value;
    const parsed = SupportContext.shape[key].safeParse(prepared);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as SupportContext;
}

/**
 * An error message with what could identify a map, a person or a place taken out: URLs, map
 * addresses, UUIDs (map and account ids), quoted strings (names, input) and long numbers (EVE
 * ids, timestamps).
 */
export function scrubClientError(text: string): string {
  return text
    .slice(0, 2000)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>()]+/gi, '<url>')
    .replace(/\/(m|p)\/[^\s'"`<>()/?#]+/g, '/$1/<slug>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g, '<str>')
    .replace(/\d{7,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUPPORT_ERROR_LENGTH);
}

const LABELS: Record<Exclude<SupportContextKey, 'errors'>, string> = {
  appVersion: 'Darkbeacon version',
  commit: 'Build',
  db: 'Database',
  login: 'Sign-in method',
  page: 'Page',
  section: 'Tab',
  viewport: 'Screen',
  browser: 'Browser',
  os: 'System',
  locale: 'Language',
  theme: 'Theme',
  scheme: 'Colour scheme',
  demo: 'Demo instance',
  instanceHost: 'Instance address',
  mapCounts: 'Map size',
};

export interface SupportContextLine {
  /** `errors.<n>` for an error line, the field otherwise. */
  id: string;
  label: string;
  value: string;
}

/** The context as lines to show (and remove one by one) before sending. */
export function supportContextLines(context: SupportContext): SupportContextLine[] {
  const lines: SupportContextLine[] = [];
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (value === undefined) continue;
    if (key === 'errors') {
      (value as string[]).forEach((error, i) =>
        lines.push({ id: `errors.${i}`, label: `Recent error ${i + 1}`, value: error }),
      );
      continue;
    }
    const text =
      key === 'mapCounts'
        ? `${context.mapCounts!.systems} systems, ${context.mapCounts!.connections} connections, ${context.mapCounts!.signatures} signatures`
        : typeof value === 'boolean'
          ? value
            ? 'Yes'
            : 'No'
          : String(value);
    lines.push({ id: key, label: LABELS[key], value: text });
  }
  return lines;
}

/** The context without one line (see `supportContextLines`). */
export function withoutContextLine(context: SupportContext, id: string): SupportContext {
  const next = { ...context };
  if (id.startsWith('errors.')) {
    const index = Number(id.slice('errors.'.length));
    const errors = (next.errors ?? []).filter((_, i) => i !== index);
    if (errors.length > 0) next.errors = errors;
    else delete next.errors;
    return next;
  }
  delete next[id as SupportContextKey];
  return next;
}

/**
 * The context as PostHog Support's `session_context` wants it: at most 20 string values of at most
 * 2000 characters each.
 */
export function flattenSupportContext(context: SupportContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of supportContextLines(withoutErrors(context))) out[snake(line.id)] = line.value;
  if (context.errors?.length) out.errors = context.errors.join('\n').slice(0, 2000);
  return out;
}

function withoutErrors(context: SupportContext): SupportContext {
  const { errors: _errors, ...rest } = context;
  return rest;
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Base64url of the context's JSON (the `?ctx=` fallback when the popup has no opener). */
export function encodeSupportContext(context: SupportContext): string {
  const bytes = new TextEncoder().encode(JSON.stringify(context));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSupportContext(encoded: string | null | undefined): SupportContext {
  if (!encoded || encoded.length > 4000) return {};
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return sanitizeSupportContext(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return {};
  }
}

/**
 * An origin a support popup may talk back to: https, or http on a loopback or `.localhost` name
 * (development). Exactly an origin: no path, query or credentials.
 */
export function isSupportOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    if (url.origin !== value) return false;
    if (url.protocol === 'https:') return true;
    const host = url.hostname;
    return (
      url.protocol === 'http:' &&
      (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost'))
    );
  } catch {
    return false;
  }
}

/** The hub's page. */
export const SUPPORT_PATH = '/support';

/**
 * Where the hub's page sends a signed-out pilot back to after the app's sign-in: the support page
 * itself (with its query: the tab and the opener's origin), never anywhere else. Anything that is
 * not a `/support` path on this site becomes `/support`.
 */
export function supportReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return SUPPORT_PATH;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || /[\x00-\x20\x7f\\]/.test(value)) return SUPPORT_PATH;
  try {
    const base = 'http://hub.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return SUPPORT_PATH;
    if (url.pathname !== SUPPORT_PATH && url.pathname !== `${SUPPORT_PATH}/`) return SUPPORT_PATH;
    return `${SUPPORT_PATH}${url.search}`;
  } catch {
    return SUPPORT_PATH;
  }
}

/** `postMessage` between an instance and the hub popup; both sides check the origin and the source. */
export const SUPPORT_MESSAGE_SOURCE = 'darkbeacon-support';
export const SupportWindowMessage = z.discriminatedUnion('type', [
  /** Hub -> opener: the page is ready for the context. */
  z.object({ source: z.literal(SUPPORT_MESSAGE_SOURCE), type: z.literal('ready') }),
  /**
   * Opener -> hub: the context (untrusted on arrival: sanitized and shown before sending), the
   * opt-in fields offered unticked, and whether the instance already has an unread handle.
   */
  z.object({
    source: z.literal(SUPPORT_MESSAGE_SOURCE),
    type: z.literal('context'),
    context: z.unknown(),
    optional: z.unknown().optional(),
    hasHandle: z.boolean().optional(),
  }),
  /** Hub -> opener: an unread handle, after the person allowed it. */
  z.object({
    source: z.literal(SUPPORT_MESSAGE_SOURCE),
    type: z.literal('handle'),
    handle: z.string(),
  }),
]);
export type SupportWindowMessage = z.infer<typeof SupportWindowMessage>;

/**
 * A message from another window, or null: it must come from `expectedOrigin` (exactly) and be one
 * of ours. Callers also check `event.source` is the window they expect.
 */
export function readSupportMessage(
  event: { origin: string; data: unknown },
  expectedOrigin: string,
): SupportWindowMessage | null {
  if (event.origin !== expectedOrigin) return null;
  const parsed = SupportWindowMessage.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}

/** Handles are opaque bearer strings: `dbsh_` and 43 base64url characters. */
export const SUPPORT_HANDLE = /^dbsh_[A-Za-z0-9_-]{43}$/;

// ---- Consent copy, shown next to the forms (and in docs/support.md) ----

export const SUPPORT_TICKET_CONSENT =
  "This sends your message and the details listed below to the Darkbeacon maintainers (ZanReal), stored in PostHog (EU). Your ticket is linked to the EVE character you pick, so you can follow it from any Darkbeacon instance. We don't send map contents, system names or your instance's address unless you tick them. You can ask us to delete your tickets.";
export const SUPPORT_FEEDBACK_CONSENT =
  'Anonymous unless you sign in. No reply is sent; open a ticket if you need one.';

// ---- Requests ----

const message = (max: number) => z.string().trim().min(1, 'Write a message first').max(max);

/** One of the signed-in account's linked characters; the main character when left out. */
const CharacterChoice = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const CreateSupportTicketRequest = z.strictObject({
  characterId: CharacterChoice.optional(),
  category: SupportCategory,
  message: message(SUPPORT_MESSAGE_MAX),
  context: SupportContext.default({}),
});
export type CreateSupportTicketRequest = z.infer<typeof CreateSupportTicketRequest>;

export const SupportReplyRequest = z.strictObject({ message: message(SUPPORT_MESSAGE_MAX) });
export type SupportReplyRequest = z.infer<typeof SupportReplyRequest>;

export const SupportFeedbackKind = z.enum(['quick', 'feature']);
export type SupportFeedbackKind = z.infer<typeof SupportFeedbackKind>;

export const SupportFeedbackRequest = z
  .strictObject({
    kind: SupportFeedbackKind,
    rating: z.number().int().min(1).max(5).optional(),
    text: z.string().trim().max(SUPPORT_FEEDBACK_MAX).default(''),
    context: SupportContext.pick({ appVersion: true, page: true, viewport: true }).default({}),
  })
  .refine((f) => (f.kind === 'quick' ? f.rating !== undefined || f.text !== '' : f.text !== ''), {
    message: 'Say something first',
    path: ['text'],
  });
export type SupportFeedbackRequest = z.infer<typeof SupportFeedbackRequest>;

export const CreateSupportHandleRequest = z.strictObject({
  origin: z.string().refine(isSupportOrigin, 'Not an https origin'),
});
export type CreateSupportHandleRequest = z.infer<typeof CreateSupportHandleRequest>;

/** `?character=`: which of the account's characters a ticket belongs to (default: the main one). */
export const SupportCharacterQuery = z.object({
  character: z.coerce.number().pipe(CharacterChoice).optional(),
});
export type SupportCharacterQuery = z.infer<typeof SupportCharacterQuery>;

export const SupportUnreadQuery = z.object({ h: z.string().regex(SUPPORT_HANDLE).optional() });
export type SupportUnreadQuery = z.infer<typeof SupportUnreadQuery>;

/** PostHog workflow -> hub: a reply was posted for this person. */
export const SupportWebhookRequest = z.object({ distinct_id: z.string().min(1).max(400) });
export type SupportWebhookRequest = z.infer<typeof SupportWebhookRequest>;

/** Instance side: the handle the hub gave this account. */
export const SaveSupportHandleRequest = z.strictObject({
  hubOrigin: z.string().refine(isSupportOrigin, 'Not an https origin'),
  handle: z.string().regex(SUPPORT_HANDLE),
});
export type SaveSupportHandleRequest = z.infer<typeof SaveSupportHandleRequest>;

export const AdminSupportTicketsQuery = z.object({
  status: z.enum([...SUPPORT_STATUSES, 'all', 'active']).default('active'),
});
export type AdminSupportTicketsQuery = z.infer<typeof AdminSupportTicketsQuery>;

export const AdminSupportTicketUpdate = z
  .strictObject({ status: SupportTicketStatus.optional(), priority: SupportPriority.optional() })
  .refine((u) => u.status !== undefined || u.priority !== undefined, 'Nothing to change');
export type AdminSupportTicketUpdate = z.infer<typeof AdminSupportTicketUpdate>;

// ---- Answers ----

export const SupportCharacterDto = z.object({ id: z.number().int(), name: z.string() });
export type SupportCharacterDto = z.infer<typeof SupportCharacterDto>;

/** A character of the signed-in account that tickets can belong to. */
export const SupportAccountCharacterDto = SupportCharacterDto.extend({ main: z.boolean() });
export type SupportAccountCharacterDto = z.infer<typeof SupportAccountCharacterDto>;

/**
 * What the hub page needs: whether the hub is on, whether someone is signed in (the app's own
 * session) and the EVE characters of their account, main first. Signed in without a character
 * (a Discord account that linked none): tickets wait until one is linked.
 */
export const SupportSessionDto = z.object({
  available: z.boolean(),
  backend: SupportBackend.nullable(),
  /** Feedback can be sent (a surveys project, or the hub's own store). */
  feedback: z.boolean(),
  signedIn: z.boolean(),
  characters: z.array(SupportAccountCharacterDto),
});
export type SupportSessionDto = z.infer<typeof SupportSessionDto>;

export const SupportTicketDto = z.object({
  id: z.string(),
  number: z.number().int().nullable(),
  category: SupportCategory.nullable(),
  status: SupportTicketStatus,
  unread: z.number().int(),
  /** The start of the last message. */
  preview: z.string().nullable(),
  lastMessageAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  messageCount: z.number().int(),
});
export type SupportTicketDto = z.infer<typeof SupportTicketDto>;

export const SupportMessageDto = z.object({
  id: z.string(),
  body: z.string(),
  author: z.enum(['you', 'support']),
  authorName: z.string().nullable(),
  createdAt: z.number().int(),
});
export type SupportMessageDto = z.infer<typeof SupportMessageDto>;

/** My tickets: those of each character of the account, main first. */
export const SupportTicketGroupDto = z.object({
  character: SupportCharacterDto,
  tickets: z.array(SupportTicketDto),
});
export type SupportTicketGroupDto = z.infer<typeof SupportTicketGroupDto>;

export const SupportThreadDto = z.object({ ticket: SupportTicketDto, messages: z.array(SupportMessageDto) });
export type SupportThreadDto = z.infer<typeof SupportThreadDto>;

export const SupportTicketCreatedDto = z.object({ id: z.string() });
export type SupportTicketCreatedDto = z.infer<typeof SupportTicketCreatedDto>;

export const SupportHandleDto = z.object({
  id: z.string(),
  origin: z.string(),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
});
export type SupportHandleDto = z.infer<typeof SupportHandleDto>;

export const SupportHandleCreatedDto = z.object({ handle: z.string() });
export type SupportHandleCreatedDto = z.infer<typeof SupportHandleCreatedDto>;

export const SupportUnreadDto = z.object({ unread: z.number().int() });
export type SupportUnreadDto = z.infer<typeof SupportUnreadDto>;

/** Every instance: where its support entries go and what they may say about it. */
export const SupportClientDto = z.object({
  /** The hub's origin, or null when support is turned off on this instance. */
  hubUrl: z.string().nullable(),
  /** This instance is the hub: the support page opens in the app. */
  inApp: z.boolean(),
  /** This account's unread handle from the hub, if it allowed one. */
  handle: z.string().nullable(),
  instance: z.object({
    appVersion: z.string(),
    commit: z.string().nullable(),
    db: z.enum(['sqlite', 'postgres']),
    loginMethod: z.enum(['discord', 'eve']),
    demo: z.boolean(),
  }),
  /** Whether the hub here keeps tickets itself (its admins answer in Admin > Support). */
  localInbox: z.boolean(),
});
export type SupportClientDto = z.infer<typeof SupportClientDto>;

export const AdminSupportTicketDto = SupportTicketDto.extend({
  character: SupportCharacterDto,
  priority: SupportPriority,
});
export type AdminSupportTicketDto = z.infer<typeof AdminSupportTicketDto>;

export const AdminSupportThreadDto = z.object({
  ticket: AdminSupportTicketDto,
  context: SupportContext,
  messages: z.array(
    SupportMessageDto.omit({ author: true }).extend({ author: z.enum(['customer', 'support']) }),
  ),
});
export type AdminSupportThreadDto = z.infer<typeof AdminSupportThreadDto>;

export const AdminSupportFeedbackDto = z.object({
  id: z.string(),
  kind: SupportFeedbackKind,
  rating: z.number().int().nullable(),
  text: z.string(),
  character: SupportCharacterDto.nullable(),
  createdAt: z.number().int(),
});
export type AdminSupportFeedbackDto = z.infer<typeof AdminSupportFeedbackDto>;

export const AdminSupportInboxDto = z.object({
  tickets: z.array(AdminSupportTicketDto),
  unanswered: z.number().int(),
});
export type AdminSupportInboxDto = z.infer<typeof AdminSupportInboxDto>;
