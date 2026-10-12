/** Current values the instance reports as gauges; read only when metrics are collected. */
export interface GaugeSources {
  /** Characters that are online, over all maps. */
  onlineCharacters(): Promise<number>;
  maps(): Promise<number>;
  /** Events each durable event-log consumer still has to handle (the outbox backlog). */
  consumerLag(): Promise<ReadonlyArray<{ consumer: string; behind: number }>>;
  /** Open realtime (WebSocket) connections. */
  realtimeConnections(): number;
}
