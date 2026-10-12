/**
 * Which process runs the work that must happen once per instance: the ESI poller, durable event
 * consumers, retention and other schedules, plugins' background jobs. A single process is
 * always the leader; replicas elect one (a Postgres advisory lock), and another takes over
 * when it goes away. Work checks `isLeader()` each time it runs, and listens for changes to
 * start or stop.
 */
export interface Leadership {
  isLeader(): boolean;
  /** Called with the new state whenever this process gains or loses leadership. */
  onChange(listener: (leader: boolean) => void): () => void;
}

/** The only process of an instance: always the leader. */
export const singleProcess: Leadership = {
  isLeader: () => true,
  onChange: () => () => {},
};
