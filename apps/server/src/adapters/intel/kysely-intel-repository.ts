import { bool, json, type Database } from '@darkbeacon/db';
import {
  sameClaim,
  type ActivityHour,
  type ActivityKind,
  type AttackerGroup,
  type IntelRepository,
  type KillParty,
  type Killmail,
  type SovereigntyClaim,
  type StoredName,
} from '@darkbeacon/intel';

export interface IntelTables {
  intel_claims: {
    system_id: number;
    alliance_id: number | null;
    corporation_id: number | null;
    faction_id: number | null;
    updated_at: number;
  };
  intel_activity: {
    system_id: number;
    hour: number;
    ship_kills: number | null;
    pod_kills: number | null;
    npc_kills: number | null;
    jumps: number | null;
  };
  intel_hours: { kind: string; hour: number };
  intel_kills: {
    id: number;
    hash: string;
    system_id: number;
    time: number;
    value: number | null;
    npc: number;
    solo: number;
    victim: string;
    final_blow: string | null;
    attacker_count: number;
    attackers: string;
  };
  intel_coverage: { system_id: number; since: number; at: number };
  intel_names: {
    id: number;
    name: string;
    category: string;
    ticker: string | null;
    ticker_known: number;
    updated_at: number;
  };
  intel_state: { key: string; value: string };
}

/** Rows per statement: well under SQLite's variable limit for every table here. */
const CHUNK = 400;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function claimOf(row: IntelTables['intel_claims']): SovereigntyClaim | null {
  if (row.alliance_id !== null)
    return { kind: 'alliance', allianceId: Number(row.alliance_id), corporationId: num(row.corporation_id) };
  if (row.faction_id !== null) return { kind: 'faction', factionId: Number(row.faction_id) };
  return null;
}

function killOf(row: IntelTables['intel_kills']): Killmail {
  return {
    id: Number(row.id),
    hash: row.hash,
    systemId: Number(row.system_id),
    time: Number(row.time),
    value: row.value === null ? null : Number(row.value),
    npc: bool.decode(row.npc),
    solo: bool.decode(row.solo),
    victim: json.decode<KillParty>(row.victim)!,
    finalBlow: json.decode<KillParty>(row.final_blow),
    attackerCount: Number(row.attacker_count),
    attackers: json.decode<AttackerGroup[]>(row.attackers) ?? [],
  };
}

/** IntelRepository over Kysely; the same SQL on SQLite and Postgres. */
export class KyselyIntelRepository implements IntelRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<IntelTables>();
  }

  // ---- Sovereignty -----------------------------------------------------------------------------

  async replaceClaims(
    claims: ReadonlyArray<{ systemId: number; claim: SovereigntyClaim }>,
    at: number,
  ): Promise<number[]> {
    return this.database.transaction(async () => {
      const current = new Map(
        (await this.db.selectFrom('intel_claims').selectAll().execute()).map((r) => [
          Number(r.system_id),
          claimOf(r),
        ]),
      );
      const next = new Map(claims.map((c) => [c.systemId, c.claim]));
      const removed = [...current.keys()].filter((id) => !next.has(id));
      const changed = claims.filter((c) => !sameClaim(current.get(c.systemId) ?? null, c.claim));
      for (const ids of chunks(removed)) {
        await this.db.deleteFrom('intel_claims').where('system_id', 'in', ids).execute();
      }
      for (const part of chunks(changed)) {
        await this.db
          .insertInto('intel_claims')
          .values(
            part.map(({ systemId, claim }) => ({
              system_id: systemId,
              alliance_id: claim.kind === 'alliance' ? claim.allianceId : null,
              corporation_id: claim.kind === 'alliance' ? claim.corporationId : null,
              faction_id: claim.kind === 'faction' ? claim.factionId : null,
              updated_at: at,
            })),
          )
          .onConflict((oc) =>
            oc.column('system_id').doUpdateSet((eb) => ({
              alliance_id: eb.ref('excluded.alliance_id'),
              corporation_id: eb.ref('excluded.corporation_id'),
              faction_id: eb.ref('excluded.faction_id'),
              updated_at: eb.ref('excluded.updated_at'),
            })),
          )
          .execute();
      }
      return [...removed, ...changed.map((c) => c.systemId)];
    });
  }

  async claims(systemIds: readonly number[]): Promise<Map<number, SovereigntyClaim>> {
    const result = new Map<number, SovereigntyClaim>();
    for (const ids of chunks([...new Set(systemIds)])) {
      const rows = await this.db
        .selectFrom('intel_claims')
        .selectAll()
        .where('system_id', 'in', ids)
        .execute();
      for (const row of rows) {
        const claim = claimOf(row);
        if (claim) result.set(Number(row.system_id), claim);
      }
    }
    return result;
  }

  async allClaims(): Promise<Map<number, SovereigntyClaim>> {
    const result = new Map<number, SovereigntyClaim>();
    for (const row of await this.db.selectFrom('intel_claims').selectAll().execute()) {
      const claim = claimOf(row);
      if (claim) result.set(Number(row.system_id), claim);
    }
    return result;
  }

  // ---- Hourly activity -------------------------------------------------------------------------

  async saveHour(
    kind: ActivityKind,
    hour: number,
    rows: ReadonlyArray<Pick<ActivityHour, 'systemId'> & Partial<Omit<ActivityHour, 'systemId' | 'hour'>>>,
  ): Promise<void> {
    await this.database.transaction(async () => {
      for (const part of chunks(rows)) {
        const values = part.map((r) => ({
          system_id: r.systemId,
          hour,
          ship_kills: kind === 'kills' ? (r.shipKills ?? 0) : null,
          pod_kills: kind === 'kills' ? (r.podKills ?? 0) : null,
          npc_kills: kind === 'kills' ? (r.npcKills ?? 0) : null,
          jumps: kind === 'jumps' ? (r.jumps ?? 0) : null,
        }));
        await this.db
          .insertInto('intel_activity')
          .values(values)
          .onConflict((oc) =>
            oc.columns(['system_id', 'hour']).doUpdateSet((eb) =>
              kind === 'kills'
                ? {
                    ship_kills: eb.ref('excluded.ship_kills'),
                    pod_kills: eb.ref('excluded.pod_kills'),
                    npc_kills: eb.ref('excluded.npc_kills'),
                  }
                : { jumps: eb.ref('excluded.jumps') },
            ),
          )
          .execute();
      }
      await this.db
        .insertInto('intel_hours')
        .values({ kind, hour })
        .onConflict((oc) => oc.columns(['kind', 'hour']).doNothing())
        .execute();
    });
  }

  async answeredHours(since: number): Promise<{ kills: Set<number>; jumps: Set<number> }> {
    const rows = await this.db.selectFrom('intel_hours').selectAll().where('hour', '>=', since).execute();
    const result = { kills: new Set<number>(), jumps: new Set<number>() };
    for (const row of rows) {
      if (row.kind === 'kills' || row.kind === 'jumps') result[row.kind].add(Number(row.hour));
    }
    return result;
  }

  async activity(systemIds: readonly number[], since: number): Promise<ActivityHour[]> {
    const result: ActivityHour[] = [];
    for (const ids of chunks([...new Set(systemIds)])) {
      const rows = await this.db
        .selectFrom('intel_activity')
        .selectAll()
        .where('system_id', 'in', ids)
        .where('hour', '>=', since)
        .execute();
      for (const r of rows) {
        result.push({
          systemId: Number(r.system_id),
          hour: Number(r.hour),
          shipKills: num(r.ship_kills),
          podKills: num(r.pod_kills),
          npcKills: num(r.npc_kills),
          jumps: num(r.jumps),
        });
      }
    }
    return result;
  }

  async pruneActivity(before: number): Promise<void> {
    await this.db.deleteFrom('intel_activity').where('hour', '<', before).execute();
    await this.db.deleteFrom('intel_hours').where('hour', '<', before).execute();
  }

  // ---- Killmails -------------------------------------------------------------------------------

  async addKills(kills: readonly Killmail[]): Promise<Killmail[]> {
    const unique = [...new Map(kills.map((k) => [k.id, k])).values()];
    if (unique.length === 0) return [];
    return this.database.transaction(async () => {
      const added: Killmail[] = [];
      for (const part of chunks(unique, 100)) {
        const known = new Set(
          (
            await this.db
              .selectFrom('intel_kills')
              .select('id')
              .where(
                'id',
                'in',
                part.map((k) => k.id),
              )
              .execute()
          ).map((r) => Number(r.id)),
        );
        const fresh = part.filter((k) => !known.has(k.id));
        if (fresh.length === 0) continue;
        await this.db
          .insertInto('intel_kills')
          .values(
            fresh.map((k) => ({
              id: k.id,
              hash: k.hash,
              system_id: k.systemId,
              time: k.time,
              value: k.value,
              npc: bool.encode(k.npc),
              solo: bool.encode(k.solo),
              victim: json.encode(k.victim),
              final_blow: k.finalBlow ? json.encode(k.finalBlow) : null,
              attacker_count: k.attackerCount,
              attackers: json.encode(k.attackers),
            })),
          )
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
        added.push(...fresh);
      }
      return added;
    });
  }

  async kills(systemId: number, since: number, limit = 500): Promise<Killmail[]> {
    const rows = await this.db
      .selectFrom('intel_kills')
      .selectAll()
      .where('system_id', '=', systemId)
      .where('time', '>=', since)
      .orderBy('time', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(killOf);
  }

  async killsIn(systemIds: readonly number[], since: number, limit: number): Promise<Killmail[]> {
    const ids = [...new Set(systemIds)];
    if (ids.length === 0) return [];
    const result: Killmail[] = [];
    for (const part of chunks(ids)) {
      const rows = await this.db
        .selectFrom('intel_kills')
        .selectAll()
        .where('system_id', 'in', part)
        .where('time', '>=', since)
        .orderBy('time', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute();
      result.push(...rows.map(killOf));
    }
    return result.sort((a, b) => b.time - a.time || b.id - a.id).slice(0, limit);
  }

  async killCounts(
    systemIds: readonly number[],
    since: number,
  ): Promise<Map<number, { count: number; last: number | null }>> {
    const result = new Map<number, { count: number; last: number | null }>();
    for (const ids of chunks([...new Set(systemIds)])) {
      const rows = await this.db
        .selectFrom('intel_kills')
        .select((eb) => ['system_id', eb.fn.countAll<number>().as('count'), eb.fn.max('time').as('last')])
        .where('system_id', 'in', ids)
        .where('time', '>=', since)
        .groupBy('system_id')
        .execute();
      for (const r of rows) result.set(Number(r.system_id), { count: Number(r.count), last: num(r.last) });
    }
    return result;
  }

  async lastKills(systemIds: readonly number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    for (const ids of chunks([...new Set(systemIds)])) {
      const rows = await this.db
        .selectFrom('intel_kills')
        .select((eb) => ['system_id', eb.fn.max('time').as('last')])
        .where('system_id', 'in', ids)
        .groupBy('system_id')
        .execute();
      for (const r of rows) if (r.last !== null) result.set(Number(r.system_id), Number(r.last));
    }
    return result;
  }

  async pruneKills(before: number): Promise<void> {
    await this.db.deleteFrom('intel_kills').where('time', '<', before).execute();
  }

  // ---- Coverage --------------------------------------------------------------------------------

  async coverage(systemIds: readonly number[]): Promise<Map<number, { since: number; at: number }>> {
    const result = new Map<number, { since: number; at: number }>();
    for (const ids of chunks([...new Set(systemIds)])) {
      const rows = await this.db
        .selectFrom('intel_coverage')
        .selectAll()
        .where('system_id', 'in', ids)
        .execute();
      for (const r of rows) result.set(Number(r.system_id), { since: Number(r.since), at: Number(r.at) });
    }
    return result;
  }

  async setCoverage(systemId: number, coverage: { since: number; at: number }): Promise<void> {
    await this.db
      .insertInto('intel_coverage')
      .values({ system_id: systemId, since: coverage.since, at: coverage.at })
      .onConflict((oc) => oc.column('system_id').doUpdateSet({ since: coverage.since, at: coverage.at }))
      .execute();
  }

  async dropCoverage(systemIds?: readonly number[]): Promise<void> {
    if (!systemIds) {
      await this.db.deleteFrom('intel_coverage').execute();
      return;
    }
    for (const ids of chunks([...new Set(systemIds)])) {
      await this.db.deleteFrom('intel_coverage').where('system_id', 'in', ids).execute();
    }
  }

  // ---- Names -----------------------------------------------------------------------------------

  async names(ids: readonly number[]): Promise<Map<number, StoredName>> {
    const result = new Map<number, StoredName>();
    for (const part of chunks([...new Set(ids)])) {
      const rows = await this.db.selectFrom('intel_names').selectAll().where('id', 'in', part).execute();
      for (const r of rows) {
        result.set(Number(r.id), {
          id: Number(r.id),
          name: r.name,
          category: r.category,
          ...(bool.decode(r.ticker_known) ? { ticker: r.ticker } : {}),
          updatedAt: Number(r.updated_at),
        });
      }
    }
    return result;
  }

  async saveNames(names: readonly StoredName[]): Promise<void> {
    for (const part of chunks([...new Map(names.map((n) => [n.id, n])).values()])) {
      await this.db
        .insertInto('intel_names')
        .values(
          part.map((n) => ({
            id: n.id,
            name: n.name,
            category: n.category,
            ticker: n.ticker ?? null,
            ticker_known: bool.encode(n.ticker !== undefined),
            updated_at: n.updatedAt,
          })),
        )
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            category: eb.ref('excluded.category'),
            ticker: eb.ref('excluded.ticker'),
            ticker_known: eb.ref('excluded.ticker_known'),
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
    }
  }

  async pruneNames(before: number): Promise<void> {
    await this.db.deleteFrom('intel_names').where('updated_at', '<', before).execute();
  }

  // ---- State -----------------------------------------------------------------------------------

  async state<T>(key: string): Promise<T | null> {
    const row = await this.db
      .selectFrom('intel_state')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return row ? json.decode<T>(row.value) : null;
  }

  async setState(key: string, value: unknown): Promise<void> {
    const encoded = json.encode(value);
    await this.db
      .insertInto('intel_state')
      .values({ key, value: encoded })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: encoded }))
      .execute();
  }
}
