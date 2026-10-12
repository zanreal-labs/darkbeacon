/**
 * Small, ephemeral messages to every process of the instance, this one included: "these systems'
 * intel changed, tell your viewers". Nothing is stored; a process that is down misses them. A
 * single process delivers them to itself. Payloads are JSON and must stay small (under 7 kB:
 * Postgres NOTIFY carries them between replicas); callers split bigger ones.
 */
export interface Signals {
  publish(topic: string, payload: unknown): void;
  /** `handler` runs for every signal of `topic`, from this process or another. */
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
}

/** Signals within one process. */
export class LocalSignals implements Signals {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}

  publish(topic: string, payload: unknown): void {
    for (const handler of this.handlers.get(topic) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  subscribe(topic: string, handler: (payload: unknown) => void): () => void {
    let set = this.handlers.get(topic);
    if (!set) this.handlers.set(topic, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }
}
