import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceActivity } from '@darkbeacon/shared';
import { ACTIVITY_GRACE_MS, ActivityTracker, activityText } from './presence-activity.js';

const moving: PresenceActivity = { verb: 'moving', target: { kind: 'system', id: '31000005' } };
const linking: PresenceActivity = { verb: 'linking', target: { kind: 'system', id: '31000005' } };
const editing: PresenceActivity = {
  verb: 'editing',
  target: { kind: 'connection', id: 'c1' },
  label: 'note',
};

describe('ActivityTracker', () => {
  let heard: Array<PresenceActivity | null>;
  let tracker: ActivityTracker;
  beforeEach(() => {
    vi.useFakeTimers();
    heard = [];
    tracker = new ActivityTracker((a) => heard.push(a));
  });
  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it('starts idle and becomes active when an action begins', () => {
    expect(tracker.active).toBe(false);
    tracker.begin('drag', moving);
    expect(tracker.active).toBe(true);
    expect(tracker.current).toEqual(moving);
    expect(heard).toEqual([moving]);
  });

  it('stays active while the action lasts, however long', () => {
    tracker.begin('drag', moving);
    vi.advanceTimersByTime(60_000);
    expect(tracker.current).toEqual(moving);
    expect(heard).toEqual([moving]);
  });

  it('keeps the activity for the grace time after the action ends, then goes idle', () => {
    tracker.begin('drag', moving);
    tracker.end('drag');
    expect(tracker.current).toEqual(moving);
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS - 1);
    expect(tracker.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tracker.active).toBe(false);
    expect(heard).toEqual([moving, null]);
  });

  it('a new action during the grace time takes over without going idle in between', () => {
    tracker.begin('drag', moving);
    tracker.end('drag');
    vi.advanceTimersByTime(1000);
    tracker.begin('link', linking);
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS * 2);
    expect(tracker.current).toEqual(linking);
    tracker.end('link');
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS);
    expect(heard).toEqual([moving, linking, null]);
  });

  it('pulses keep it alive until the grace time after the last one', () => {
    tracker.pulse(editing);
    vi.advanceTimersByTime(2000);
    tracker.pulse(editing);
    vi.advanceTimersByTime(2000);
    tracker.pulse(editing);
    expect(heard).toEqual([editing]);
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS);
    expect(heard).toEqual([editing, null]);
  });

  it('shows the latest of overlapping actions, and the earlier one again when that ends', () => {
    tracker.begin('dialog', editing);
    tracker.begin('drag', moving);
    expect(tracker.current).toEqual(moving);
    tracker.end('drag');
    expect(tracker.current).toEqual(editing);
    // Still held by the dialog: no grace runs out.
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS * 2);
    expect(tracker.current).toEqual(editing);
    tracker.end('dialog');
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS);
    expect(heard).toEqual([editing, moving, editing, null]);
  });

  it('ignores the end of something that never began, and repeated ends', () => {
    tracker.end('drag');
    expect(heard).toEqual([]);
    tracker.begin('drag', moving);
    tracker.end('drag');
    tracker.end('drag');
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS);
    expect(heard).toEqual([moving, null]);
  });

  it('says nothing after dispose', () => {
    tracker.begin('drag', moving);
    tracker.end('drag');
    tracker.dispose();
    vi.advanceTimersByTime(ACTIVITY_GRACE_MS);
    expect(heard).toEqual([moving]);
  });
});

describe('activityText', () => {
  it('puts the activity in a few words', () => {
    expect(activityText(moving)).toBe('moving');
    expect(activityText(linking)).toBe('linking');
    expect(activityText({ verb: 'pasting' })).toBe('pasting scan');
    expect(activityText({ verb: 'editing', label: 'J014348' })).toBe('editing J014348');
    expect(activityText({ verb: 'editing' })).toBe('editing');
  });
});
