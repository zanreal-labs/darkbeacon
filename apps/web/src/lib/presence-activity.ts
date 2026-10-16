import type { PresenceActivity } from '@darkbeacon/shared';

/** How long the others keep seeing a cursor after the action ends. */
export const ACTIVITY_GRACE_MS = 2500;

export interface ActivityTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: ActivityTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What this tab is changing, as the presence layer reports it. */
export interface ActivityReporter {
  /** An action that lasts (a drag, an open edit dialog) starts; `token` names it for `end`. */
  begin(token: string, activity: PresenceActivity): void;
  /** That action ended: the others keep seeing it for the grace time. */
  end(token: string): void;
  /** A moment of activity (a keystroke in an inline editor): seen until the grace time after the last one. */
  pulse(activity: PresenceActivity): void;
}

/**
 * What this tab is actively changing, for the others: idle until an action begins (or a pulse),
 * active while any action holds it (the latest one is shown), then a grace time with the last
 * activity once nothing holds it, then idle again. `onChange` hears each change of what is shown
 * (null: idle); the cursor is shared only while it is not null.
 */
export class ActivityTracker implements ActivityReporter {
  /** Actions holding the activity, oldest first. */
  private readonly held = new Map<string, PresenceActivity>();
  /** What stays shown with nothing held: the last action that ended, or the last pulse. */
  private lingering: PresenceActivity | null = null;
  private timer: unknown = null;
  private shown: PresenceActivity | null = null;
  private readonly graceMs: number;
  private readonly timers: ActivityTimers;

  constructor(
    private readonly onChange: (activity: PresenceActivity | null) => void,
    options: { graceMs?: number; timers?: ActivityTimers } = {},
  ) {
    this.graceMs = options.graceMs ?? ACTIVITY_GRACE_MS;
    this.timers = options.timers ?? realTimers;
  }

  /** What the others see this tab doing; null when idle. */
  get current(): PresenceActivity | null {
    return this.shown;
  }

  get active(): boolean {
    return this.shown !== null;
  }

  begin(token: string, activity: PresenceActivity): void {
    this.held.delete(token);
    this.held.set(token, activity);
    this.cancelGrace();
    this.lingering = null;
    this.emit();
  }

  end(token: string): void {
    const ended = this.held.get(token);
    if (!ended) return;
    this.held.delete(token);
    if (this.held.size === 0) {
      this.lingering = ended;
      this.startGrace();
    }
    this.emit();
  }

  pulse(activity: PresenceActivity): void {
    this.lingering = activity;
    if (this.held.size === 0) this.startGrace();
    this.emit();
  }

  /** Forgets everything without telling anyone (the view went away). */
  dispose(): void {
    this.cancelGrace();
    this.held.clear();
    this.lingering = null;
    this.shown = null;
  }

  private startGrace(): void {
    this.cancelGrace();
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.lingering = null;
      this.emit();
    }, this.graceMs);
  }

  private cancelGrace(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const next = [...this.held.values()].at(-1) ?? this.lingering;
    if (sameActivity(next, this.shown)) return;
    this.shown = next;
    this.onChange(next);
  }
}

export function sameActivity(a: PresenceActivity | null, b: PresenceActivity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.verb === b.verb &&
    a.label === b.label &&
    (a.target ?? null)?.kind === (b.target ?? null)?.kind &&
    (a.target ?? null)?.id === (b.target ?? null)?.id
  );
}

/** "moving", "linking", "editing J014348", "pasting scan". */
export function activityText(activity: PresenceActivity): string {
  switch (activity.verb) {
    case 'moving':
      return 'moving';
    case 'linking':
      return 'linking';
    case 'pasting':
      return 'pasting scan';
    case 'editing':
      return activity.label ? `editing ${activity.label}` : 'editing';
  }
}
