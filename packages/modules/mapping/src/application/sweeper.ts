import type { Actor } from '@darkbeacon/core';
import { SIGNATURE_LAZY_DELETE_HOURS } from '@darkbeacon/shared';
import { lifetimeOf } from '../domain/intel.js';
import { connectionLocked } from '../domain/lifetime.js';
import type { Connection, MapSystem } from '../domain/map.js';
import { pairKey, signatureKey } from '../domain/stamps.js';
import { MappingUseCases } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';
import { removeConnection } from './systems.js';

/** What the sweeper does, from the instance settings. */
export interface SweepSettings {
  /** Minutes after a wormhole cannot exist any more before it is deleted; null never deletes. */
  expiredConnectionMinutes: number | null;
  /** Mark wormholes EOL when the last 4 hours of their lifetime begin. */
  autoEol: boolean;
  /** Hide systems left alone this many minutes (see `sweep`); null never. */
  staleSystemMinutes: number | null;
}

/** Systems of a map with a tracked character in them (tracking owns presence). */
export interface MapOccupancy {
  occupied(mapId: string): Promise<Set<number>>;
}

export interface SweepResult {
  eol: number;
  deleted: number;
  hidden: number;
  /** Signatures removed by the map's lazy delete. */
  signatures: number;
}

/** The sweeper's changes are the system's, as `system:sweeper`. */
export const SWEEPER: Actor = { kind: 'system', id: 'sweeper' };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Keeps a map's chain honest as time passes, like Wanderer's cleanup ticks:
 * - a wormhole whose lifetime's last 4 hours begin is marked EOL (`eolAt` = that moment), which
 *   the Discord notifier and webhooks report like any EOL;
 * - a wormhole past the latest moment it can exist (`connectionLifetime`) is deleted, as a
 *   deliberate removal (tombstone), `expiredConnectionMinutes` later;
 * - a visible system nobody touched for `staleSystemMinutes`, with no connection, no tracked
 *   character in it, not locked and not home, is hidden (its intel stays);
 * - with the map's lazy delete on (the default), a scanner result added more than
 *   `SIGNATURE_LAZY_DELETE_HOURS` ago is removed, as a deliberate removal (tombstone, so a merge or
 *   a Wanderer sync does not bring it back), unless it leads through a connection still on the
 *   map (that hole's own lifetime decides; once the connection goes, the signature follows) or it
 *   is a custom entry someone wrote. Hidden systems' signatures go quietly.
 * Locked connections and systems are left alone. Composites have nothing of their own to sweep.
 * Every change is an event of the map, audited as the `sweeper` process.
 */
export class ChainSweeper extends MappingUseCases {
  async sweep(mapId: string, settings: SweepSettings, occupancy?: MapOccupancy): Promise<SweepResult> {
    const result: SweepResult = { eol: 0, deleted: 0, hidden: 0, signatures: 0 };
    const map = await this.ports.maps.findById(mapId);
    if (!map || map.kind === 'composite') return result;
    const now = this.ports.clock.now();
    const { universe } = this.ports;

    const systems = await this.ports.systems.list(mapId);
    const visible = new Set(systems.filter((s) => s.visible).map((s) => s.solarSystemId));
    const signatures = await this.ports.signatures.listForMap(mapId);
    const expired: Connection[] = [];
    const turning: Array<{ connection: Connection; eolAt: number }> = [];
    for (const connection of await this.ports.connections.list(mapId)) {
      if (connection.type !== 'wormhole' || connectionLocked(connection)) continue;
      if (!visible.has(connection.source) || !visible.has(connection.target)) continue;
      const { lifetime } = lifetimeOf({
        connection,
        source: universe.getSystem(connection.source),
        target: universe.getSystem(connection.target),
        signatures: signatures.filter((s) => s.connectionId === connection.id),
        wormholeType: (code) => universe.wormholeType(code),
      });
      if (
        settings.expiredConnectionMinutes !== null &&
        lifetime.expiresBy !== null &&
        now >= lifetime.expiresBy + settings.expiredConnectionMinutes * MINUTE
      )
        expired.push(connection);
      else if (
        settings.autoEol &&
        connection.timeStatus === 'normal' &&
        lifetime.eolBy !== null &&
        now >= lifetime.eolBy
      )
        turning.push({ connection, eolAt: lifetime.eolBy });
    }

    if (expired.length > 0 || turning.length > 0) {
      await this.write(SWEEPER, mapId, async (events) => {
        for (const { connection, eolAt } of turning) {
          const current = await this.ports.connections.findById(mapId, connection.id);
          if (!current || current.timeStatus !== 'normal' || connectionLocked(current)) continue;
          const next: Connection = { ...current, timeStatus: 'eol', eolAt, updatedAt: now };
          await this.ports.connections.update(next);
          events.add('connection.updated', next, current);
          result.eol += 1;
        }
        for (const connection of expired) {
          const current = await this.ports.connections.findById(mapId, connection.id);
          if (!current || connectionLocked(current)) continue;
          await this.ports.stamps.putTombstone(
            mapId,
            'connection',
            pairKey(current.source, current.target),
            now,
          );
          await removeConnection(this.ports, events, current);
          result.deleted += 1;
        }
        if (result.deleted > 0) await renumberBookmarks(this.ports, events, mapId);
      });
    }

    if (settings.staleSystemMinutes !== null) {
      const idleSince = now - settings.staleSystemMinutes * MINUTE;
      const occupied = (await occupancy?.occupied(mapId)) ?? new Set<number>();
      const connected = new Set(
        (await this.ports.connections.list(mapId)).flatMap((c) => [c.source, c.target]),
      );
      const lastTouched = new Map<number, number>();
      for (const s of signatures)
        lastTouched.set(s.solarSystemId, Math.max(lastTouched.get(s.solarSystemId) ?? 0, s.updatedAt));
      const stale = systems.filter(
        (s) =>
          s.visible &&
          !s.locked &&
          s.status !== 'home' &&
          !connected.has(s.solarSystemId) &&
          !occupied.has(s.solarSystemId) &&
          Math.max(s.updatedAt, lastTouched.get(s.solarSystemId) ?? 0) <= idleSince,
      );
      if (stale.length > 0) {
        await this.write(SWEEPER, mapId, async (events) => {
          for (const system of stale) {
            const current = await this.ports.systems.find(mapId, system.solarSystemId);
            if (!current?.visible || current.locked) continue;
            const hidden: MapSystem = { ...current, visible: false, updatedAt: now };
            await this.ports.systems.update(hidden);
            events.add('system.removed', { solarSystemId: current.solarSystemId }, current);
            result.hidden += 1;
          }
          if (result.hidden > 0) await renumberBookmarks(this.ports, events, mapId);
        });
      }
    }
    // A deleted map waits as it was, for a restore or the purge.
    if (map.settings.signatureLazyDelete !== false && !map.deletedAt)
      result.signatures = await this.lazyDelete(mapId, now);
    return result;
  }

  /** Removes the map's scanner results older than the lazy delete allows; returns how many. */
  private async lazyDelete(mapId: string, now: number): Promise<number> {
    const addedBefore = now - SIGNATURE_LAZY_DELETE_HOURS * HOUR;
    const old = (await this.ports.signatures.listForMap(mapId)).filter(
      (s) => !s.custom && s.createdAt <= addedBefore,
    );
    if (old.length === 0) return 0;
    const connections = new Set((await this.ports.connections.list(mapId)).map((c) => c.id));
    const doomed = old.filter((s) => !s.connectionId || !connections.has(s.connectionId));
    if (doomed.length === 0) return 0;
    return this.write(SWEEPER, mapId, async (events) => {
      const visible = new Set(
        (await this.ports.systems.list(mapId)).filter((s) => s.visible).map((s) => s.solarSystemId),
      );
      let removed = 0;
      for (const signature of doomed) {
        const current = await this.ports.signatures.findById(mapId, signature.id);
        if (!current || current.createdAt > addedBefore) continue;
        await this.ports.stamps.putTombstone(
          mapId,
          'signature',
          signatureKey(current.solarSystemId, current.eveId),
          now,
        );
        await this.ports.signatures.delete(mapId, current.id);
        if (visible.has(current.solarSystemId))
          events.add('signature.removed', { id: current.id, solarSystemId: current.solarSystemId }, current);
        removed++;
      }
      return removed;
    });
  }
}
