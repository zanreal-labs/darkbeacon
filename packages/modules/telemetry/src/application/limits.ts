/** At most `limit` takes per clock minute. */
export class MinuteCap {
  private window = -1;
  private used = 0;

  constructor(private readonly limit: number) {}

  take(now: number): boolean {
    const window = Math.floor(now / 60_000);
    if (window !== this.window) {
      this.window = window;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

/** The last `size` items. */
export class Ring<T> {
  private readonly items: T[] = [];

  constructor(private readonly size: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.size) this.items.shift();
  }

  newestFirst(): T[] {
    return [...this.items].reverse();
  }
}
