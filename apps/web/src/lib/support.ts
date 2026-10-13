import {
  encodeSupportContext,
  readSupportMessage,
  routes,
  sanitizeSupportContext,
  scrubClientError,
  SUPPORT_ERRORS_MAX,
  SUPPORT_MESSAGE_SOURCE,
  TelemetrySection,
  telemetryThemeId,
  viewportBucket,
  type SupportBrowser,
  type SupportClientDto,
  type SupportContext,
  type SupportOs,
  type SupportPage,
  type SupportWindowMessage,
} from '@darkbeacon/shared';

/**
 * Every instance's side of support (docs/support.md): what a ticket may say about this browser
 * and instance, opening the hub in a popup and handing it that context over `postMessage`, and the
 * unread handle the hub hands back.
 */

export const supportClientKey = ['support-client'] as const;
export const SUPPORT_CLIENT_PATH = routes.support.client.path;
/** Where the in-app page (on the hub itself) finds the context. */
export const IN_APP_CONTEXT_KEY = 'dbk-support-context';

export type SupportKind = 'ticket' | 'feedback' | 'tickets';

// ---- The last client errors, scrubbed as they are recorded ----

const errors: string[] = [];

export function recordClientError(message: unknown): void {
  const text = scrubClientError(typeof message === 'string' ? message : String(message ?? ''));
  if (!text) return;
  errors.push(text);
  if (errors.length > SUPPORT_ERRORS_MAX) errors.shift();
}

export function recentClientErrors(): string[] {
  return [...errors];
}

/** Test support. */
export function resetClientErrors(): void {
  errors.length = 0;
}

let capturing = false;

/** Keeps the last few uncaught errors of this page (scrubbed) for a ticket. Idempotent. */
export function installErrorCapture(): void {
  if (capturing || typeof window === 'undefined') return;
  capturing = true;
  window.addEventListener('error', (event) => recordClientError(event.message || event.error));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: unknown } | undefined;
    recordClientError(reason?.message ?? reason);
  });
}

// ---- The open map's size, offered as an opt-in ----

type MapCounts = NonNullable<SupportContext['mapCounts']>;
let mapCounts: (() => MapCounts) | null = null;

/** The map page registers how to count its structures; null when it unmounts. */
export function provideMapCounts(counter: (() => MapCounts) | null): void {
  mapCounts = counter;
}

// ---- Context ----

/** The kind of page, never its address (no map slugs). */
export function supportPage(pathname: string): SupportPage {
  if (pathname === '/' || pathname.startsWith('/m/')) return 'map';
  const first = pathname.split('/')[1] ?? '';
  const known: Record<string, SupportPage> = {
    maps: 'maps',
    account: 'account',
    admin: 'admin',
    import: 'import',
    jump: 'jump',
    characters: 'characters',
    changelog: 'changelog',
  };
  if (first === 'oauth') return 'oauth_consent';
  return known[first] ?? 'other';
}

/** The admin tab or the open map settings section, when it is one of the known ones. */
export function supportSection(page: SupportPage, search: URLSearchParams): SupportContext['section'] {
  const raw = page === 'admin' ? search.get('tab') : page === 'map' ? search.get('settings') : null;
  const parsed = TelemetrySection.safeParse(raw ?? (page === 'admin' ? 'instance' : undefined));
  return parsed.success ? parsed.data : undefined;
}

export function browserFamily(userAgent: string): SupportBrowser {
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/OPR\/|Opera/.test(userAgent)) return 'opera';
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

export function osFamily(userAgent: string): SupportOs {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/CrOS/.test(userAgent)) return 'chromeos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macos';
  if (/Linux/.test(userAgent)) return 'linux';
  return 'other';
}

export interface SupportContextParts {
  /** Sent unless removed. */
  context: SupportContext;
  /** Offered unticked: the instance address, the open map's size. */
  optional: SupportContext;
}

/** What a ticket started here may carry: the allow-list of `SupportContext`, nothing else. */
export function buildSupportContext(input: {
  client: SupportClientDto;
  location: { pathname: string; search: string; host: string };
  theme: { preference: string; scheme: 'light' | 'dark' };
  navigator: { userAgent: string; language: string };
  width: number;
}): SupportContextParts {
  const page = supportPage(input.location.pathname);
  const section = supportSection(page, new URLSearchParams(input.location.search));
  const { instance } = input.client;
  const context = sanitizeSupportContext({
    appVersion: instance.appVersion,
    commit: instance.commit ?? undefined,
    db: instance.db,
    login: instance.loginMethod,
    page,
    section,
    viewport: viewportBucket(input.width),
    browser: browserFamily(input.navigator.userAgent),
    os: osFamily(input.navigator.userAgent),
    locale: input.navigator.language,
    theme: telemetryThemeId(input.theme.preference),
    scheme: input.theme.scheme,
    demo: instance.demo,
    errors: recentClientErrors(),
  });
  if (context.errors?.length === 0) delete context.errors;
  const optional = sanitizeSupportContext({
    instanceHost: input.location.host.toLowerCase(),
    mapCounts: page === 'map' ? mapCounts?.() : undefined,
  });
  return { context, optional };
}

/** The hub page's address. The `?ctx=` fallback is short: no errors, no opt-in fields. */
export function supportUrl(
  hubUrl: string,
  kind: SupportKind,
  origin: string,
  context: SupportContext,
): string {
  const { errors: _errors, ...short } = context;
  const params = new URLSearchParams({ kind, origin, ctx: encodeSupportContext(short) });
  return `${hubUrl}/support?${params}`;
}

/**
 * Opens the hub in a popup and answers its `ready` with the context. Only messages from the hub's
 * origin and from the popup itself are read; the context is only ever posted to the hub's origin.
 * Returns false when the browser blocked the popup.
 */
export function openSupportPopup(input: {
  hubUrl: string;
  kind: SupportKind;
  parts: SupportContextParts;
  hasHandle: boolean;
  onHandle(handle: string): void;
  win?: Window;
}): boolean {
  const win = input.win ?? window;
  const hubOrigin = new URL(input.hubUrl).origin;
  const popup = win.open(
    supportUrl(input.hubUrl, input.kind, win.location.origin, input.parts.context),
    'darkbeacon-support',
    'popup,width=600,height=860',
  );
  if (!popup) return false;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== popup) return;
    const message = readSupportMessage(event, hubOrigin);
    if (!message) return;
    if (message.type === 'ready') {
      const reply: SupportWindowMessage = {
        source: SUPPORT_MESSAGE_SOURCE,
        type: 'context',
        context: input.parts.context,
        optional: input.parts.optional,
        hasHandle: input.hasHandle,
      };
      popup.postMessage(reply, hubOrigin);
    } else if (message.type === 'handle') input.onHandle(message.handle);
  };
  win.addEventListener('message', onMessage);
  // Stop listening once the popup is gone.
  const timer = win.setInterval(() => {
    if (popup.closed) {
      win.clearInterval(timer);
      win.removeEventListener('message', onMessage);
    }
  }, 1000);
  return true;
}

/** Fetches the unread count for this browser: the hub session on the hub, a handle elsewhere. */
export async function fetchUnread(client: SupportClientDto): Promise<number | 'gone'> {
  if (!client.hubUrl) return 0;
  if (client.inApp) {
    const response = await fetch(routes.support.unread.path, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.ok ? ((await response.json()) as { unread: number }).unread : 0;
  }
  if (!client.handle) return 0;
  const response = await fetch(
    `${client.hubUrl}${routes.support.unread.path}?h=${encodeURIComponent(client.handle)}`,
    {
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    },
  );
  if (response.status === 404) return 'gone';
  return response.ok ? ((await response.json()) as { unread: number }).unread : 0;
}
