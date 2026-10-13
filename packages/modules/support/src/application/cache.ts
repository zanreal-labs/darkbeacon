/** A small map whose entries expire; bounded so a flood of identities cannot grow it forever. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly max = 5_000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: this.now() });
    if (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deleteWhere(test: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (test(key)) this.entries.delete(key);
  }
}
