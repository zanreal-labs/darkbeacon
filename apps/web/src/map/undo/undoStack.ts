import { buildPath, routes, type UndoResultDto } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';

/*
 * Ctrl+Z on the map: the last gestures of this tab (a drag, a delete, a status change, a paste),
 * newest on top. Each gesture sends its changes with one action id; undoing it asks the server
 * to revert them all through the map's history, so an undo is recorded like any change and is
 * refused for what somebody changed again since. Other things that can be put back (removed
 * signatures, which the sidebar keeps for a while) join the same stack with their own `undo`.
 */

/** How many gestures one tab can take back, as in Wanderer. */
export const UNDO_DEPTH = 20;

export type UndoOutcome =
  /** `partly`: some changes stayed (changed again since); says why. */
  { ok: true; partly?: string } | { ok: false; reason: string };

export interface UndoEntry {
  id: number;
  /** What the gesture did, as a sentence start: "Removed J123456". */
  label: string;
  undo(): Promise<UndoOutcome>;
}

/** A gesture's id, sent as the `x-darkbeacon-action` header with each of its requests. */
export function newActionId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return random.replace(/[^A-Za-z0-9_-]/g, '');
}

/** Asks the server to undo one gesture on a map. */
export async function undoAction(mapId: string, action: string): Promise<UndoOutcome> {
  try {
    const result = await api<UndoResultDto>(buildPath(routes.undo.action.path, { mapId }), {
      method: 'POST',
      json: { action },
    });
    return result.failed.length > 0 ? { ok: true, partly: result.failed[0]!.reason } : { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        reason: error.status === 404 ? 'It is not in the history any more' : error.message,
      };
    }
    return { ok: false, reason: 'Network error' };
  }
}

/** The stack of one map view; `useSyncExternalStore` reads `getSnapshot`. */
export class UndoStack {
  private entries: readonly UndoEntry[] = [];
  private nextId = 0;
  private readonly listeners = new Set<() => void>();
  private running = false;

  constructor(private readonly depth = UNDO_DEPTH) {}

  push(entry: Omit<UndoEntry, 'id'>): number {
    const id = ++this.nextId;
    this.entries = [...this.entries, { ...entry, id }].slice(-this.depth);
    this.emit();
    return id;
  }

  /** Drops an entry that cannot be undone any more (its undo window passed). */
  forget(id: number): void {
    if (!this.entries.some((e) => e.id === id)) return;
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  /**
   * Undoes the newest gesture. It leaves the stack whatever happens: a refused undo would be
   * refused again. Null when there is nothing to undo or an undo is still running.
   */
  async undo(): Promise<{ label: string; outcome: UndoOutcome } | null> {
    const top = this.entries.at(-1);
    if (!top || this.running) return null;
    this.running = true;
    this.entries = this.entries.slice(0, -1);
    this.emit();
    try {
      return { label: top.label, outcome: await top.undo() };
    } finally {
      this.running = false;
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly UndoEntry[] => this.entries;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** "Removed J123456" -> "removed J123456", for "Undone: removed J123456". */
export function lowerFirst(text: string): string {
  return text.length > 1 && text[1] === text[1]!.toLowerCase()
    ? text[0]!.toLowerCase() + text.slice(1)
    : text;
}
