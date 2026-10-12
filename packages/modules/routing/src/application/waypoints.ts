import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  requireAccount,
  ValidationError,
  type Actor,
} from '@darkbeacon/core';
import type { WaypointRequest } from '@darkbeacon/shared';
import type { PilotDirectory, RoutingUniverse, WaypointGateway } from '../ports/index.js';

/** ESI scope of `POST /ui/autopilot/waypoint`. */
export const WAYPOINT_SCOPE = 'esi-ui.write_waypoint.v1';

/** Sets a character's in-game destination or adds a waypoint, through ESI. */
export class Waypoints {
  constructor(
    private readonly deps: { pilots: PilotDirectory; gateway: WaypointGateway; universe: RoutingUniverse },
  ) {}

  async set(actor: Actor | null, characterId: number, request: WaypointRequest): Promise<void> {
    const account = requireAccount(actor);
    if ((await this.deps.pilots.ownerOf(characterId)) !== account.id) throw new NotFoundError('Character');
    if (!this.deps.universe.getSystem(request.solarSystemId))
      throw new ValidationError(`Unknown solar system ${request.solarSystemId}`);
    if (!(await this.deps.pilots.scopes(characterId)).includes(WAYPOINT_SCOPE))
      throw new ForbiddenError('Link this character again to let Darkbeacon set its destination');
    const token = await this.deps.pilots.accessToken(characterId);
    if (!token) throw new ForbiddenError("The character's EVE login expired; link it again");
    try {
      await this.deps.gateway.setWaypoint(token, {
        destinationId: request.solarSystemId,
        clearOtherWaypoints: request.mode === 'destination',
        addToBeginning: false,
      });
    } catch {
      throw new ConflictError('EVE did not take the destination; try again in a moment');
    }
  }
}
