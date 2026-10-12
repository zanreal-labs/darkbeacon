import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  requireAccount,
  ValidationError,
  type Actor,
} from '@darkbeacon/core';
import type { WaypointRequest, WaypointsRequest, WaypointsResultDto } from '@darkbeacon/shared';
import type { PilotDirectory, RoutingUniverse, StationCatalog, WaypointGateway } from '../ports/index.js';

/** ESI scope of `POST /ui/autopilot/waypoint`. */
export const WAYPOINT_SCOPE = 'esi-ui.write_waypoint.v1';

type Mode = WaypointRequest['mode'];

/** What ESI is asked for each mode: replace the route, append, or put first. */
const FLAGS: Record<Mode, { clearOtherWaypoints: boolean; addToBeginning: boolean }> = {
  destination: { clearOtherWaypoints: true, addToBeginning: false },
  waypoint: { clearOtherWaypoints: false, addToBeginning: false },
  front: { clearOtherWaypoints: false, addToBeginning: true },
};

/** Sets a character's in-game destination or adds a waypoint (a system or an NPC station), through ESI. */
export class Waypoints {
  constructor(
    private readonly deps: {
      pilots: PilotDirectory;
      gateway: WaypointGateway;
      universe: RoutingUniverse;
      stations?: StationCatalog;
    },
  ) {}

  async set(actor: Actor | null, characterId: number, request: WaypointRequest): Promise<void> {
    const account = requireAccount(actor);
    if ((await this.deps.pilots.ownerOf(characterId)) !== account.id) throw new NotFoundError('Character');
    const destinationId = this.destination(request);
    await this.send(characterId, destinationId, request.mode);
  }

  /** The same destination for several own characters (all that may, without a list); never throws per character. */
  async setMany(actor: Actor | null, request: WaypointsRequest): Promise<WaypointsResultDto> {
    const account = requireAccount(actor);
    const destinationId = this.destination(request);
    const own = await this.deps.pilots.charactersOf(account.id);
    const wanted = request.characterIds
      ? own.filter((c) => request.characterIds!.includes(c.id))
      : await this.able(own);
    if (wanted.length === 0) throw new ValidationError('None of your characters may set the in-game route');
    const results = await Promise.all(
      wanted.map(async (c) => {
        try {
          await this.send(c.id, destinationId, request.mode);
          return { characterId: c.id, name: c.name, ok: true, message: null };
        } catch (error) {
          return {
            characterId: c.id,
            name: c.name,
            ok: false,
            message: error instanceof Error ? error.message : 'Failed',
          };
        }
      }),
    );
    return { results };
  }

  private async able(characters: Array<{ id: number; name: string }>) {
    const scoped = await Promise.all(
      characters.map(async (c) =>
        (await this.deps.pilots.scopes(c.id)).includes(WAYPOINT_SCOPE) ? c : null,
      ),
    );
    return scoped.filter((c): c is { id: number; name: string } => c !== null);
  }

  /** The system, or the station in it when one is named. */
  private destination(request: { solarSystemId: number; stationId?: number | undefined }): number {
    if (!this.deps.universe.getSystem(request.solarSystemId))
      throw new ValidationError(`Unknown solar system ${request.solarSystemId}`);
    if (request.stationId === undefined) return request.solarSystemId;
    const station = this.deps.stations?.station(request.stationId);
    if (!station || station.solarSystemId !== request.solarSystemId)
      throw new ValidationError(`Unknown station ${request.stationId} in that system`);
    return station.id;
  }

  private async send(characterId: number, destinationId: number, mode: Mode): Promise<void> {
    if (!(await this.deps.pilots.scopes(characterId)).includes(WAYPOINT_SCOPE))
      throw new ForbiddenError('Link this character again to let Darkbeacon set its destination');
    const token = await this.deps.pilots.accessToken(characterId);
    if (!token) throw new ForbiddenError("The character's EVE login expired; link it again");
    try {
      await this.deps.gateway.setWaypoint(token, { destinationId, ...FLAGS[mode] });
    } catch {
      throw new ConflictError('EVE did not take the destination; try again in a moment');
    }
  }
}
