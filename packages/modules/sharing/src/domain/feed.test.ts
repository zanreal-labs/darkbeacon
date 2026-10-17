import { describe, expect, it } from 'vitest';
import { feedSignal } from './feed.js';

const outcome = (changed: number) => ({
  systems: { created: 0, updated: changed, unchanged: 3, skipped: 0, removed: 0 },
});
const finished = (status: 'done' | 'failed', changed: number) => ({
  type: 'import.finished',
  data: { jobId: 'j', source: {}, status, outcome: outcome(changed), error: null },
});

describe('feed signals', () => {
  it('reads every system and signature again after an import changed something (hidden ones change silently)', () => {
    expect(feedSignal(finished('done', 2))).toEqual({
      kind: 'objects',
      selectors: [
        { kind: 'system', all: true },
        { kind: 'signature', all: true },
      ],
    });
    expect(feedSignal(finished('done', 0))).toBeNull();
    // A failed import may have written part of it.
    expect(feedSignal(finished('failed', 2))).not.toBeNull();
  });
});
