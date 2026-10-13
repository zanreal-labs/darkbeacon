import {
  ConflictError,
  actorRef,
  mapStream,
  newEvent,
  NotFoundError,
  requireMapRole,
  type Actor,
  type Clock,
  type EventLog,
  type GrantingMapRole,
  type MapAccess,
  type NewEvent,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { EventPayloads, EventType } from '@darkbeacon/shared';
import type { MapSystem } from '../domain/map.js';
import type {
  AuthorDirectory,
  ChainOverlay,
  ChangeStamps,
  CommentRepository,
  ConnectionRepository,
  MapRepository,
  PassageRepository,
  PilotDirectory,
  PingAuthorDirectory,
  PingRepository,
  SignatureRepository,
  StructureRepository,
  SystemRepository,
  UniverseCatalog,
  MapDirectory,
} from '../ports/index.js';

/** Everything the mapping use cases need, wired by the composition root. */
export interface MappingPorts {
  maps: MapRepository;
  systems: SystemRepository;
  connections: ConnectionRepository;
  signatures: SignatureRepository;
  passages: PassageRepository;
  /** Names of the pilots of tracked jumps; absent: passages show no names. */
  pilots?: PilotDirectory;
  /** Field change times and deletions, for maps that merge this one. */
  stamps: ChangeStamps;
  /** Merged chains of maps that merge others (sharing); absent: every map shows its own rows. */
  overlay?: ChainOverlay;
  universe: UniverseCatalog;
  /** Names written on signatures, comments and structures; absent: nobody is named. */
  authors?: AuthorDirectory;
  /** Structures and comments, for map files and copies; absent: maps travel without them. */
  structures?: StructureRepository;
  comments?: CommentRepository;
  /** Accounts, the map creation policy and rule counts; absent: anyone creates, no inventory names. */
  directory?: MapDirectory;
  /** Rally pings; absent: no pings (and nothing is held on the map by one). */
  pings?: PingRepository;
  /** Who called a ping, with which character; absent: pings carry no names. */
  pingAuthors?: PingAuthorDirectory;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
}

/** Collects the events of one use case; appended together before the transaction commits. */
export class EventBatch {
  readonly events: NewEvent[] = [];

  constructor(
    private readonly actor: Actor,
    private readonly mapId: string,
    private readonly now: number,
  ) {}

  /**
   * `before`: the entity before an update, or the one removed (for the audit trail). A
   * connection added in this batch and updated again (numbered) is published once, as it ends up.
   */
  add<K extends EventType>(type: K, data: EventPayloads[K], before?: unknown): void {
    if (type === 'connection.updated') {
      const id = (data as EventPayloads['connection.updated']).id;
      const added = this.events.find(
        (e) => e.type === 'connection.added' && (e.data as EventPayloads['connection.added']).id === id,
      );
      if (added) {
        added.data = data;
        return;
      }
    }
    this.events.push(
      newEvent({
        stream: mapStream(this.mapId),
        type,
        actor: actorRef(this.actor),
        data,
        occurredAt: this.now,
        ...(before === undefined ? {} : { before }),
      }),
    );
  }
}

export abstract class MappingUseCases {
  constructor(protected readonly ports: MappingPorts) {}

  /** Throws unless the actor holds at least `min` on the map; returns the (now known) actor. */
  protected async authorize(actor: Actor | null, mapId: string, min: GrantingMapRole): Promise<Actor> {
    await requireMapRole(this.ports.access, actor, mapId, min);
    return actor!;
  }

  /**
   * Throws unless the actor may change the map's own systems, connections and signatures:
   * member+, on a map that has objects of its own (a composite only shows other maps').
   */
  protected async authorizeEdit(actor: Actor | null, mapId: string): Promise<Actor> {
    const who = await this.authorize(actor, mapId, 'member');
    if ((await this.ports.maps.findById(mapId))?.kind === 'composite')
      throw new ConflictError('This map merges other maps; change them through it');
    return who;
  }

  /**
   * Runs `work` in one transaction and appends the events it collected in the same transaction,
   * so state and events commit (or roll back) together.
   */
  protected write<T>(actor: Actor, mapId: string, work: (events: EventBatch) => Promise<T>): Promise<T> {
    return this.ports.uow.transaction(async () => {
      const batch = new EventBatch(actor, mapId, this.ports.clock.now());
      const result = await work(batch);
      await this.ports.events.append(batch.events);
      return result;
    });
  }

  /** A system on the map that is not hidden. Hidden systems are invisible to every command. */
  protected async visibleSystem(mapId: string, solarSystemId: number): Promise<MapSystem> {
    const system = await this.ports.systems.find(mapId, solarSystemId);
    if (!system?.visible) throw new NotFoundError('System');
    return system;
  }

  /**
   * A system the map holds, shown or hidden: imports keep the intel of systems taken off the map
   * (structures, comments), there when the system shows up again.
   */
  protected async knownSystem(mapId: string, solarSystemId: number): Promise<MapSystem> {
    const system = await this.ports.systems.find(mapId, solarSystemId);
    if (!system) throw new NotFoundError('System');
    return system;
  }
}
