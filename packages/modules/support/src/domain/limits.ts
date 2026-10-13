/**
 * What one pilot (or one address, for anonymous feedback) may do on the hub, on top of the
 * instance's per-address limit and PostHog's own (30 a minute per widget session, 3600 an hour per
 * token).
 */
export const SUPPORT_LIMITS = {
  /** New tickets per character. */
  tickets: { limit: 5, perMinutes: 60 },
  /** Replies per character (a conversation, not a flood). */
  replies: { limit: 30, perMinutes: 60 },
  /** Feedback per character, or per address when anonymous. */
  feedback: { limit: 10, perMinutes: 60 },
  /** New unread handles per character. */
  handles: { limit: 10, perMinutes: 60 },
  /** Unread polls per handle (instances poll every two minutes). */
  unread: { limit: 6, perMinutes: 1 },
} as const;

export type SupportLimitName = keyof typeof SUPPORT_LIMITS;

/** How long ticket lists and threads are reused before asking the desk again. */
export const SUPPORT_CACHE_MS = 45_000;
/** Active unread handles per identity; the oldest goes when a new one is made. */
export const SUPPORT_HANDLES_MAX = 10;

/** Ticket ids are UUIDs on both desks; anything else is refused before it reaches one. */
export const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
