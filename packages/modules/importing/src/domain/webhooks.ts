import type { ReportBuilder } from './report.js';
import type { WandererWebhook } from './wanderer.js';

/**
 * A Wanderer webhook subscription as a Darkbeacon webhook of the map. It is added switched off:
 * Darkbeacon signs with its own secret and sends its own event shapes, so the receiver has to be
 * set up for them before an admin switches it on.
 */
export interface PlannedWebhook {
  /** Stable external id: Wanderer's subscription id, or the URL when it gives none. */
  key: string;
  url: string;
  /** Darkbeacon event types (`system.added`, `signature.*`...). */
  events: string[];
  /** Whether it was on in Wanderer (it still comes over switched off). */
  activeInWanderer: boolean;
}

/**
 * Wanderer's webhook events (https://wanderer.ltd/news/webhooks) and the Darkbeacon events that
 * tell the same thing. `signatures_updated` fires for any change to a system's signatures, so it
 * covers all three signature events; an ACL member change is a rule removed and added here.
 */
const EVENTS: Record<string, readonly string[]> = {
  add_system: ['system.added'],
  deleted_system: ['system.removed'],
  system_metadata_changed: ['system.updated'],
  connection_added: ['connection.added'],
  connection_removed: ['connection.removed'],
  connection_updated: ['connection.updated'],
  signature_added: ['signature.added'],
  signature_removed: ['signature.removed'],
  signatures_updated: ['signature.added', 'signature.updated', 'signature.removed'],
  acl_member_added: ['access.rule_added'],
  acl_member_removed: ['access.rule_removed'],
  acl_member_updated: ['access.rule_added', 'access.rule_removed'],
};

/** Everything Wanderer sends, for a subscription to `*`. */
const ALL = ['system.*', 'connection.*', 'signature.*', 'access.rule_added', 'access.rule_removed'];

const URL_MAX = 2000;

export function planWebhooks(webhooks: readonly WandererWebhook[], report: ReportBuilder): PlannedWebhook[] {
  const out = new Map<string, PlannedWebhook>();
  for (const hook of webhooks) {
    const where = redact(hook.url);
    let url: URL;
    try {
      url = new URL(hook.url);
    } catch {
      report.dropped(
        'webhook',
        'Webhook with an address that is not a URL',
        'It cannot be delivered to',
        where,
      );
      continue;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || hook.url.length > URL_MAX) {
      report.dropped('webhook', 'Webhook that is not http or https', 'Webhooks post over http(s)', where);
      continue;
    }
    const events = new Set<string>();
    const unknown: string[] = [];
    for (const name of hook.events) {
      const key = name.trim().toLowerCase();
      if (key === '*') ALL.forEach((e) => events.add(e));
      else if (EVENTS[key]) EVENTS[key].forEach((e) => events.add(e));
      else unknown.push(name);
    }
    if (hook.events.length === 0) ALL.forEach((e) => events.add(e));
    for (const name of unknown)
      report.dropped(
        'webhook',
        `Webhook event "${name}"`,
        name === 'map_kill'
          ? 'Darkbeacon webhooks send no kills; the map reads them live from zKillboard'
          : 'Darkbeacon has no event like it',
        where,
      );
    if (events.size === 0) {
      report.dropped('webhook', 'Webhook with no event Darkbeacon sends', 'It would never be called', where);
      continue;
    }
    const key = hook.id ?? `url:${hook.url}`;
    if (out.has(key)) continue;
    report.approximated(
      'webhook',
      'Webhook (added switched off)',
      'Darkbeacon signs with its own secret and sends its own event shapes; a map admin switches it on once the receiver expects them',
      where,
    );
    out.set(key, { key, url: hook.url, events: [...events], activeInWanderer: hook.active });
  }
  return [...out.values()];
}

/** The address without path or query (they may hold a token), for reports. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '(not a URL)';
  }
}
