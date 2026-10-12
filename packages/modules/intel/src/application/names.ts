import type { Clock } from '@darkbeacon/core';
import type { IntelEntityDto } from '@darkbeacon/shared';
import { DAY, MINUTE } from '../domain/activity.js';
import { factionShortName } from '../domain/sovereignty.js';
import type { IntelRepository, NameResolver, StoredName } from '../ports/index.js';

/** Names and tickers change rarely (renames, a new ticker); a week old is fresh enough. */
const NAME_TTL = 7 * DAY;
/** After ESI failed, names are not asked for again this soon (the error limit is shared). */
const FAILURE_PAUSE = MINUTE;
/** Tickers looked up per call; the rest come with the next one. */
const TICKER_BUDGET = 24;
const TICKER_CONCURRENCY = 6;

export type NameBook = ReadonlyMap<number, StoredName>;

/** An id with what ESI calls it, for DTOs (`name` and `ticker` null while unknown). */
export function entityOf(id: number | null, book: NameBook): IntelEntityDto | null {
  if (id === null) return null;
  const known = book.get(id);
  return { id, name: known?.name ?? null, ticker: known?.ticker ?? null };
}

/**
 * Names of the ids intel shows, kept in the database (shared by every map and restart) and
 * fetched from ESI when missing or older than a week. Tickers of corporations and alliances need
 * one ESI call each, so only those asked for are looked up, a few per call.
 */
export class IntelNames {
  private pausedUntil = 0;

  constructor(
    private readonly deps: {
      repo: IntelRepository;
      resolver: NameResolver;
      clock: Clock;
      onError?: (error: unknown) => void;
    },
  ) {}

  /** What is known of `ids`; `tickersOf` are corporations and alliances whose ticker is needed. */
  async lookup(ids: Iterable<number>, tickersOf: Iterable<number> = []): Promise<NameBook> {
    const wanted = [...new Set(ids)];
    const now = this.deps.clock.now();
    const book = new Map(await this.deps.repo.names(wanted));
    const stale = wanted.filter((id) => {
      const known = book.get(id);
      return !known || now - known.updatedAt > NAME_TTL;
    });
    if (stale.length > 0 && now >= this.pausedUntil) {
      try {
        const found = await this.deps.resolver.names(stale);
        const rows: StoredName[] = found.map((n) => {
          const old = book.get(n.id);
          return {
            id: n.id,
            name: n.name,
            category: n.category,
            // A faction's short name stands in for a ticker; others keep a ticker already looked up.
            ticker:
              n.category === 'faction'
                ? factionShortName(n.name)
                : old?.name === n.name
                  ? old.ticker
                  : undefined,
            updatedAt: now,
          };
        });
        await this.deps.repo.saveNames(rows);
        for (const row of rows) book.set(row.id, row);
      } catch (error) {
        this.fail(error, now);
      }
    }
    await this.tickers(book, [...new Set(tickersOf)], now);
    return book;
  }

  private async tickers(book: Map<number, StoredName>, ids: number[], now: number): Promise<void> {
    const missing = ids
      .map((id) => book.get(id))
      .filter(
        (n): n is StoredName =>
          !!n && (n.category === 'corporation' || n.category === 'alliance') && n.ticker === undefined,
      )
      .slice(0, TICKER_BUDGET);
    if (missing.length === 0 || now < this.pausedUntil) return;
    const done: StoredName[] = [];
    let index = 0;
    const worker = async () => {
      while (index < missing.length && now >= this.pausedUntil) {
        const entry = missing[index++]!;
        try {
          const ticker = await this.deps.resolver.ticker(
            entry.category as 'corporation' | 'alliance',
            entry.id,
          );
          const row = { ...entry, ticker };
          done.push(row);
          book.set(row.id, row);
        } catch (error) {
          this.fail(error, now);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TICKER_CONCURRENCY, missing.length) }, worker));
    if (done.length > 0) await this.deps.repo.saveNames(done);
  }

  private fail(error: unknown, now: number): void {
    this.pausedUntil = now + FAILURE_PAUSE;
    this.deps.onError?.(error);
  }
}
