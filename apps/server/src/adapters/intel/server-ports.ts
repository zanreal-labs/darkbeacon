import { mapStream, type Signals } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import type {
  IntelChange,
  IntelChanges,
  IntelMetrics,
  IntelPublisher,
  IntelSystems,
  IntelUniverse,
  StandingPilots,
} from '@darkbeacon/intel';
import type { MappingPorts, UniverseCatalog } from '@darkbeacon/mapping';
import type { DomainTelemetry } from '@darkbeacon/observability';
import type { UniverseSystemDto } from '@darkbeacon/shared';
import type { RealtimeHub } from '../../realtime/realtime.hub.js';

/**
 * Which systems intel follows: every system any map holds (composites hold none of their own;
 * their sources do), and a map's systems as its viewers see them (the merged chain on maps that
 * merge others, so a composite gets intel for exactly the systems its shares let it see).
 */
export class MappingIntelSystems implements IntelSystems {
  constructor(
    private readonly database: Database,
    private readonly ports: Pick<MappingPorts, 'maps' | 'systems' | 'overlay'>,
  ) {}

  async watched(): Promise<Set<number>> {
    const rows = await this.database
      .db<{ map_systems: { solar_system_id: number } }>()
      .selectFrom('map_systems')
      .select('solar_system_id')
      .distinct()
      .execute();
    return new Set(rows.map((r) => Number(r.solar_system_id)));
  }

  async onMap(mapId: string): Promise<Array<{ id: number; visible: boolean }> | null> {
    if (!(await this.ports.maps.findById(mapId))) return null;
    const merged = await this.ports.overlay?.view(mapId);
    const systems = merged ? merged.systems : await this.ports.systems.list(mapId);
    return systems.map((s) => ({ id: s.solarSystemId, visible: s.visible }));
  }

  /**
   * Maps with the system visible on their own rows, and maps that merge others (sharing keeps a
   * `chain_views` row for each) whose merged chain shows it. A map in both is read through its
   * merged chain, the one its viewers see.
   */
  async mapsShowing(systemId: number): Promise<string[]> {
    const db = this.database.db<{
      map_systems: { map_id: string; solar_system_id: number; visible: number };
      chain_views: { map_id: string };
    }>();
    const [own, merged] = await Promise.all([
      db
        .selectFrom('map_systems')
        .select('map_id')
        .where('solar_system_id', '=', systemId)
        .where('visible', '=', 1)
        .execute(),
      db.selectFrom('chain_views').select('map_id').execute(),
    ]);
    const mergedIds = new Set(merged.map((r) => r.map_id));
    const result = own.map((r) => r.map_id).filter((id) => !mergedIds.has(id));
    for (const mapId of mergedIds) {
      const systems = await this.onMap(mapId);
      if (systems?.some((s) => s.id === systemId && s.visible)) result.push(mapId);
    }
    return result;
  }
}

export class CatalogIntelUniverse implements IntelUniverse {
  constructor(
    private readonly catalog: Pick<UniverseCatalog, 'getSystem'> & { systems(): Iterable<UniverseSystemDto> },
  ) {}

  space(systemId: number) {
    const system = this.catalog.getSystem(systemId);
    return system ? { security: system.security, whClass: system.whClass, region: system.regionName } : null;
  }

  *all() {
    for (const s of this.catalog.systems()) {
      yield { id: s.id, space: { security: s.security, whClass: s.whClass, region: s.regionName } };
    }
  }
}

/** The signal topic intel changes travel on. */
export const INTEL_CHANGED = 'intel.changed';
/** Systems per signal: a NOTIFY payload stays well under its limit. */
const SYSTEMS_PER_SIGNAL = 500;

/** Intel changes as signals to every replica (each pushes to its own viewers). */
export class SignalIntelChanges implements IntelChanges {
  constructor(private readonly signals: Pick<Signals, 'publish'>) {}

  announce(change: IntelChange): void {
    const { systemIds, claims } = change;
    if (systemIds.length <= SYSTEMS_PER_SIGNAL) {
      this.signals.publish(INTEL_CHANGED, change);
      return;
    }
    for (let i = 0; i < systemIds.length; i += SYSTEMS_PER_SIGNAL) {
      this.signals.publish(INTEL_CHANGED, {
        systemIds: systemIds.slice(i, i + SYSTEMS_PER_SIGNAL),
        claims: claims && i === 0,
      } satisfies IntelChange);
    }
  }
}

/** Reads a signal's payload as an intel change; null when it is not one. */
export function asIntelChange(payload: unknown): IntelChange | null {
  const p = payload as Partial<IntelChange> | null;
  if (!p || !Array.isArray(p.systemIds) || !p.systemIds.every((id) => Number.isInteger(id))) return null;
  return { systemIds: p.systemIds, claims: p.claims === true };
}

/** Pushes over the realtime hub to whoever follows the map's stream (its authorization applies). */
export class HubIntelPublisher implements IntelPublisher {
  constructor(private readonly hub: Pick<RealtimeHub, 'followed' | 'broadcast'>) {}

  followedMaps(): string[] {
    return this.hub.followed('map');
  }

  push(mapId: string, update: Parameters<IntelPublisher['push']>[1]): void {
    const stream = mapStream(mapId);
    this.hub.broadcast(stream, { op: 'intel', stream, systems: update.systems });
  }
}

export class TelemetryIntelMetrics implements IntelMetrics {
  constructor(private readonly telemetry: DomainTelemetry) {}

  zkillRequest(endpoint: 'r2z2' | 'api', outcome: string): void {
    this.telemetry.zkillRequest(endpoint, outcome);
  }

  killsStored(source: 'feed' | 'history', count: number): void {
    this.telemetry.intelKillsStored(source, count);
  }
}

/** What standings need from identity: an account's characters (main first) and their tokens. */
export class IdentityStandingPilots implements StandingPilots {
  constructor(
    private readonly identity: {
      main(accountId: string): Promise<number | null>;
      listForAccount(
        accountId: string,
      ): Promise<
        Array<{ id: number; corporationId: number; allianceId: number | null; tokenValid: boolean }>
      >;
      scopes(characterId: number): Promise<string[]>;
      accessToken(characterId: number): Promise<string | null>;
    },
  ) {}

  async characters(accountId: string) {
    const [main, characters] = await Promise.all([
      this.identity.main(accountId),
      this.identity.listForAccount(accountId),
    ]);
    const sorted = [...characters].sort(
      (a, b) => Number(b.id === main) - Number(a.id === main) || a.id - b.id,
    );
    return Promise.all(
      sorted.map(async (c) => ({
        id: c.id,
        corporationId: c.corporationId,
        allianceId: c.allianceId,
        scopes: c.tokenValid ? await this.identity.scopes(c.id) : [],
      })),
    );
  }

  accessToken(characterId: number): Promise<string | null> {
    return this.identity.accessToken(characterId);
  }
}
