/** Query key of one system's static data (shared with server components, so no hooks here). */
export const universeKey = (id: number) => ['universe', id] as const;
