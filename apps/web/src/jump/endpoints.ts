/** The two ends of a route, as indexes into the star model. */
export interface Endpoints {
  origin: number | null;
  destination: number | null;
}

export type EndpointsAction =
  | { type: 'origin'; system: number | null }
  | { type: 'destination'; system: number | null }
  | { type: 'swap' }
  | { type: 'clear' };

/**
 * Start and destination change together in one step, so a swap is never seen half done. A system
 * picked for one end that is the other end leaves the other end empty (a route needs two systems).
 */
export function endpointsReducer(state: Endpoints, action: EndpointsAction): Endpoints {
  switch (action.type) {
    case 'origin':
      if (action.system === state.origin) return state;
      return {
        origin: action.system,
        destination: action.system !== null && action.system === state.destination ? null : state.destination,
      };
    case 'destination':
      if (action.system === state.destination) return state;
      return {
        origin: action.system !== null && action.system === state.origin ? null : state.origin,
        destination: action.system,
      };
    case 'swap':
      if (state.origin === state.destination) return state;
      return { origin: state.destination, destination: state.origin };
    case 'clear':
      return state.origin === null && state.destination === null
        ? state
        : { origin: null, destination: null };
  }
}
