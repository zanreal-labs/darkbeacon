import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Leadership } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { ChainSweeper, type MappingPorts, type SweepResult } from '@darkbeacon/mapping';
import { KyselyMapOccupancy } from '../../adapters/mapping/map-occupancy.js';
import type { AppConfig } from '../../config/config.js';
import { AsyncAuditScope } from '../../platform/audit.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { APP_CONFIG, LEADERSHIP } from '../../platform/tokens.js';
import { MAPPING_PORTS } from './mapping.tokens.js';

/** How often the sweeper looks at every map (Wanderer's connection cleanup runs every 5 minutes). */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Runs the sweeper (`ChainSweeper`) over every map every five minutes with the instance's
 * settings (Admin, Instance): EOL as lifetimes run out, expired wormholes deleted, idle systems
 * hidden, and each map's lazy delete of day-old signatures (Map settings, Signatures). Not in tests (they call `runOnce`), not in demo mode, not during maintenance.
 */
@Injectable()
export class SweeperRuntime implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sweeper');
  private readonly sweeper: ChainSweeper;
  private readonly occupancy: KyselyMapOccupancy;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAPPING_PORTS) private readonly ports: MappingPorts,
    @Inject(Database) database: Database,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(AsyncAuditScope) private readonly audit: AsyncAuditScope,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
  ) {
    this.sweeper = new ChainSweeper(ports);
    this.occupancy = new KyselyMapOccupancy(database);
  }

  onApplicationBootstrap(): void {
    // The demo's seeded chain is a showcase with fixed timestamps: sweeping would empty it overnight.
    if (this.config.env === 'test' || this.config.demoMode) return;
    // One replica sweeps (the leader): two would mark the same connections twice.
    this.timer = setInterval(() => {
      if (this.leadership.isLeader()) void this.runOnce();
    }, SWEEP_INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One pass over every map; a pass still running makes the next one a no-op. */
  async runOnce(): Promise<SweepResult> {
    const total: SweepResult = { eol: 0, deleted: 0, hidden: 0, signatures: 0 };
    if (this.running || this.maintenance.active) return total;
    this.running = true;
    try {
      const current = await this.settings.current();
      const settings = {
        expiredConnectionMinutes: current.expiredConnectionMinutes ?? null,
        autoEol: current.autoEol ?? true,
        staleSystemMinutes: current.staleSystemMinutes ?? null,
      };
      for (const mapId of await this.ports.maps.allIds()) {
        try {
          const done = await this.audit.run(
            { channel: { kind: 'system', id: 'sweeper' }, origin: undefined },
            () => this.sweeper.sweep(mapId, settings, this.occupancy),
          );
          total.eol += done.eol;
          total.deleted += done.deleted;
          total.hidden += done.hidden;
          total.signatures += done.signatures;
        } catch (error) {
          this.logger.error(
            `sweeping map ${mapId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (total.eol + total.deleted + total.hidden + total.signatures > 0)
        this.logger.log(
          `marked ${total.eol} EOL, deleted ${total.deleted} expired, hid ${total.hidden} idle systems, lazily deleted ${total.signatures} signatures`,
        );
      return total;
    } finally {
      this.running = false;
    }
  }
}
