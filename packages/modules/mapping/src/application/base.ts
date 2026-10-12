import {
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
  ConnectionRepository,
  MapRepository,
  SignatureRepository,
  SystemRepository,
  UniverseCatalog,
} from '../ports/index.js';

/** Everything the mapping use cases need, wired by the composition root. */
export interface MappingPorts {
  maps: MapRepository;
  systems: SystemRepository;
  connections: ConnectionRepository;
  signatures: SignatureRepository;
  universe: UniverseCatalog;
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

  add<K extends EventType>(type: K, data: EventPayloads[K]): void {
    this.events.push(
      newEvent({
        stream: mapStream(this.mapId),
        type,
        actor: actorRef(this.actor),
        data,
        occurredAt: this.now,
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
}
