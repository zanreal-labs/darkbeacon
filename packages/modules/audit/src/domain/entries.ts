import { parseStream, type DomainEvent } from '@darkbeacon/core';
import type { AuditEntryDto } from '@darkbeacon/shared';
import { asFields } from './diff.js';
import { defaultChannel, type AuditRecord } from './record.js';

/** An event as stored, with its audit record (null for events written before the trail existed). */
export interface StoredEvent {
  event: DomainEvent;
  audit: AuditRecord | null;
}

/** Position in a history, newest first: time, then seq, then stream. */
export interface AuditCursor {
  occurredAt: number;
  seq: number;
  stream: string;
}

export function encodeCursor(cursor: AuditCursor): string {
  return `${cursor.occurredAt}_${cursor.seq}_${cursor.stream}`;
}

export function decodeCursor(text: string | undefined): AuditCursor | null {
  if (!text) return null;
  const match = /^(\d+)_(\d+)_(.+)$/.exec(text);
  if (!match) return null;
  return { occurredAt: Number(match[1]), seq: Number(match[2]), stream: match[3]! };
}

/** The map an entry belongs to: its map stream, or the `mapId` of a map webhook record. */
export function mapIdOf(event: DomainEvent): string | null {
  const parsed = parseStream(event.stream);
  if (parsed?.kind === 'map') return parsed.id;
  const mapId = asFields(event.data)?.mapId;
  return typeof mapId === 'string' ? mapId : null;
}

export function toEntry(
  stored: StoredEvent,
  options: { showOrigin: boolean; revertible: boolean; revertedBy: string | null },
): AuditEntryDto {
  const { event, audit } = stored;
  return {
    id: event.id,
    stream: event.stream,
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt,
    mapId: mapIdOf(event),
    actor: audit?.actor ?? {
      kind: event.actor.kind,
      id: event.actor.id,
      accountId: event.actor.kind === 'account' ? event.actor.id : null,
      accountName: null,
      characterId: null,
      characterName: null,
    },
    channel: audit?.channel ?? defaultChannel(event.actor),
    origin: options.showOrigin ? (audit?.origin ?? null) : null,
    op: audit?.op ?? 'activity',
    entity: audit?.entity ?? null,
    diff: audit?.diff ?? {},
    removed: audit?.removed ?? null,
    revertOf: audit?.revertOf ?? null,
    revertedBy: options.revertedBy,
    revertible: options.revertible && audit !== null && options.revertedBy === null,
    recorded: audit !== null,
  };
}

const CSV_COLUMNS = [
  'time',
  'type',
  'map',
  'person',
  'character',
  'channel',
  'entity',
  'changes',
  'removed',
  'country',
  'userAgent',
  'revertOf',
  'id',
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  // Spreadsheet formula injection: a leading =, +, - or @ would run as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const show = (value: unknown) =>
  value === null || value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);

/** One header line plus a line per entry. */
export function toCsv(entries: readonly AuditEntryDto[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of entries) {
    const changes = Object.entries(e.diff)
      .map(([field, c]) => `${field}: ${show(c.before)} -> ${show(c.after)}`)
      .join('; ');
    lines.push(
      [
        new Date(e.occurredAt).toISOString(),
        e.type,
        e.mapId,
        e.actor.accountName ?? e.actor.accountId ?? `${e.actor.kind}:${e.actor.id}`,
        e.actor.characterName ?? e.actor.characterId,
        e.channel.id ? `${e.channel.kind}:${e.channel.id}` : e.channel.kind,
        e.entity ? `${e.entity.kind}:${e.entity.id}` : null,
        changes,
        e.removed,
        e.origin?.country,
        e.origin?.userAgent,
        e.revertOf,
        e.id,
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
