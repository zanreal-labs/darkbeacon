import type { ImportReportBucket, ImportReportLineDto } from '@darkbeacon/shared';

const MAX_EXAMPLES = 5;
const ORDER: Record<ImportReportBucket, number> = { mapped: 0, approximated: 1, dropped: 2 };

/**
 * The mapping report: what came over as it was, what was approximated and what was left out and
 * why. Lines with the same bucket, kind and wording are counted together with a few examples.
 */
export class ReportBuilder {
  private readonly lines = new Map<string, ImportReportLineDto>();

  add(
    bucket: ImportReportBucket,
    kind: string,
    what: string,
    why: string | null = null,
    example?: string,
  ): void {
    const key = `${bucket}\u0000${kind}\u0000${what}\u0000${why ?? ''}`;
    let line = this.lines.get(key);
    if (!line) this.lines.set(key, (line = { bucket, kind, what, why, count: 0, examples: [] }));
    line.count++;
    if (example && line.examples.length < MAX_EXAMPLES && !line.examples.includes(example))
      line.examples.push(example);
  }

  mapped(kind: string, what: string, example?: string): void {
    this.add('mapped', kind, what, null, example);
  }

  approximated(kind: string, what: string, why: string, example?: string): void {
    this.add('approximated', kind, what, why, example);
  }

  dropped(kind: string, what: string, why: string, example?: string): void {
    this.add('dropped', kind, what, why, example);
  }

  build(): ImportReportLineDto[] {
    return [...this.lines.values()].sort(
      (a, b) => ORDER[a.bucket] - ORDER[b.bucket] || a.kind.localeCompare(b.kind) || b.count - a.count,
    );
  }
}
