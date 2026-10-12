import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { AuditTrail } from '@darkbeacon/audit';
import { isInstanceAdmin, type Clock, type MapAccess } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  BookmarkNumberUseCases,
  CommentUseCases,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  StructureUseCases,
  SystemUseCases,
  type MappingPorts,
} from '@darkbeacon/mapping';
import { KyselyAuditStore } from '../../adapters/audit/kysely-audit-store.js';
import { MappingReverter } from '../../adapters/audit/mapping-reverter.js';
import { IntelReverter } from '../../adapters/audit/intel-reverter.js';
import { KyselyStructureRepository } from '../../adapters/mapping/kysely-intel.js';
import { AsyncAuditScope } from '../../platform/audit.js';
import { CLOCK, MAP_ACCESS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { AuditController } from './audit.controller.js';
import { EventRetention } from './event-retention.js';

/**
 * The audit trail over the event log: map, system and connection histories, the instance audit,
 * exports, reverting one change, the hash chain check and the event log's retention.
 */
@Module({
  imports: [MappingModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AuditTrail,
      useFactory: (database: Database, access: MapAccess, scope: AsyncAuditScope, clock: Clock) =>
        new AuditTrail({ store: new KyselyAuditStore(database), access, scope, clock }),
      inject: [Database, MAP_ACCESS, AsyncAuditScope, CLOCK],
    },
    EventRetention,
  ],
  exports: [AuditTrail, EventRetention],
})
export class AuditModule implements OnModuleInit {
  constructor(
    @Inject(AuditTrail) private readonly trail: AuditTrail,
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(MAPPING_PORTS) private readonly ports: MappingPorts,
    @Inject(MapUseCases) private readonly maps: MapUseCases,
    @Inject(SystemUseCases) private readonly systems: SystemUseCases,
    @Inject(ConnectionUseCases) private readonly connections: ConnectionUseCases,
    @Inject(SignatureUseCases) private readonly signatures: SignatureUseCases,
    @Inject(BookmarkNumberUseCases) private readonly numbers: BookmarkNumberUseCases,
    @Inject(CommentUseCases) private readonly comments: CommentUseCases,
    @Inject(StructureUseCases) private readonly structures: StructureUseCases,
    @Inject(Database) private readonly database: Database,
  ) {}

  onModuleInit(): void {
    this.trail.registerReverter(
      new MappingReverter(this.ports, {
        maps: this.maps,
        systems: this.systems,
        connections: this.connections,
        signatures: this.signatures,
        numbers: this.numbers,
      }),
    );
    const structures = new KyselyStructureRepository(this.database);
    this.trail.registerReverter(
      new IntelReverter(this.comments, this.structures, (mapId, id) => structures.findById(mapId, id)),
    );
    // The instance audit can be followed live by instance admins only.
    this.realtime.registerStream('audit', {
      authorize: (actor, id) => id === 'instance' && isInstanceAdmin(actor),
    });
  }
}
