/**
 * Transaction boundary for use cases. Repositories and the EventLog called inside `work`
 * share one transaction; nested calls join the outer one. Events appended inside are
 * published only after commit.
 */
export interface UnitOfWork {
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
