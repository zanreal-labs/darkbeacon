import pg from 'pg';
import {
  emptyDump,
  readAclMember,
  readAll,
  readComment,
  readConnection,
  readPassage,
  readSignature,
  readStructure,
  readSystem,
  readSystemLabels,
  readUserHubs,
  readWebhook,
  SourceError,
  text,
  type SourceRequest,
  type WandererAcl,
  type WandererDbMap,
  type WandererDbRequest,
  type WandererDbSource,
  type WandererMapDump,
} from '@darkbeacon/importing';

export interface WandererDbOptions {
  /** Longest one connection may take to open. */
  connectTimeoutMs?: number;
  /** Longest one query may run (Postgres `statement_timeout`). */
  statementTimeoutMs?: number;
  now?: () => number;
}

type Row = Record<string, unknown>;

/**
 * The columns read from Wanderer's tables, by table. Only these are ever selected (the character
 * table also holds encrypted tokens, which are never read); a column a Wanderer version lacks is
 * read as null. Names are the ones of our fork's Ash resources (`*_v1` tables).
 */
const COLUMNS = {
  maps_v1: ['id', 'name', 'slug', 'description', 'scope', 'scopes', 'system_labels', 'hubs', 'deleted'],
  map_system_v1: [
    'id',
    'map_id',
    'solar_system_id',
    'name',
    'custom_name',
    'description',
    'tag',
    'labels',
    'status',
    'visible',
    'locked',
    'position_x',
    'position_y',
    'temporary_name',
    'inserted_at',
    'updated_at',
  ],
  map_chain_v1: [
    'id',
    'map_id',
    'solar_system_source',
    'solar_system_target',
    'mass_status',
    'time_status',
    'ship_size_type',
    'type',
    'wormhole_type',
    'count_of_passage',
    'locked',
    'custom_info',
    'dangerous',
    'bubbled',
    'mass_status_updated_at',
    'inserted_at',
    'updated_at',
  ],
  map_system_signatures_v1: [
    'id',
    'system_id',
    'eve_id',
    'character_eve_id',
    'name',
    'description',
    'temporary_name',
    'kind',
    'group',
    'type',
    'custom_info',
    'linked_system_id',
    'deleted',
    'inserted_at',
    'updated_at',
  ],
  map_system_structures_v1: [
    'id',
    'system_id',
    'solar_system_id',
    'structure_type_id',
    'structure_type',
    'character_eve_id',
    'name',
    'notes',
    'owner_name',
    'owner_ticker',
    'owner_id',
    'status',
    'end_time',
    'inserted_at',
    'updated_at',
  ],
  map_system_comments_v1: ['id', 'system_id', 'character_id', 'text', 'inserted_at'],
  map_chain_passages_v1: [
    'id',
    'map_id',
    'character_id',
    'ship_type_id',
    'solar_system_source_id',
    'solar_system_target_id',
    'inserted_at',
  ],
  character_v1: ['id', 'eve_id', 'name'],
  map_access_lists_v1: ['map_id', 'access_list_id'],
  access_lists_v1: ['id', 'name'],
  access_list_members_v1: [
    'access_list_id',
    'name',
    'eve_character_id',
    'eve_corporation_id',
    'eve_alliance_id',
    'role',
  ],
  map_user_settings_v1: ['map_id', 'hubs'],
  map_character_settings_v1: ['map_id', 'tracked'],
  map_webhook_subscriptions_v1: ['id', 'map_id', 'url', 'events', 'active?'],
} as const;

type Table = keyof typeof COLUMNS;
type Columns = Map<Table, Set<string>>;

/** Timestamps as ISO text in UTC (Wanderer stores them without a zone, in UTC). */
const TIME_COLUMNS = new Set(['inserted_at', 'updated_at', 'end_time', 'mass_status_updated_at']);

/**
 * Reads a map straight from a Wanderer's Postgres database: every system, hidden ones included,
 * the map's label names, connections with their locks, marks and notes, signatures (custom ones
 * and anomalies too), structures, comments with their authors, passages one by one, ACLs with
 * their members, hubs and webhooks. Everything runs in one READ ONLY transaction with a statement
 * timeout, selects named columns only (never the character table's tokens) and is rolled back.
 * Row shapes are the ones the API and export readers already understand, so the plan, preview,
 * merge and report are shared with the other sources.
 */
export class WandererDatabaseSource implements WandererDbSource {
  readonly kind = 'wanderer-db' as const;

  constructor(private readonly options: WandererDbOptions = {}) {}

  async maps(connectionString: string): Promise<WandererDbMap[]> {
    return this.session(connectionString, async (query, columns) => {
      const has = (column: string) => columns.get('maps_v1')?.has(column) ?? false;
      const rows = await query(
        `select m.slug, m.name,
                count(s.id) filter (where coalesce(s.visible, true)) as shown,
                count(s.id) filter (where not coalesce(s.visible, true)) as hidden
           from maps_v1 m left join map_system_v1 s on s.map_id = m.id
          ${has('deleted') ? 'where not coalesce(m.deleted, false)' : ''}
          group by m.id, m.slug, m.name
          order by lower(coalesce(m.name, m.slug))`,
      );
      return rows.map((row) => ({
        slug: String(row.slug),
        name: text(row.name),
        systems: Number(row.shown),
        hiddenSystems: Number(row.hidden),
      }));
    });
  }

  async test(
    request: SourceRequest,
  ): Promise<{ systems: number; hiddenSystems: number | null; name: string | null }> {
    const db = asDb(request);
    const map = (await this.maps(db.connectionString)).find((m) => m.slug === db.slug);
    if (!map) throw notFound(db);
    return { systems: map.systems, hiddenSystems: map.hiddenSystems, name: map.name };
  }

  async read(request: SourceRequest, onStep?: (step: string) => void): Promise<WandererMapDump> {
    const db = asDb(request);
    return this.session(db.connectionString, async (query, columns) => {
      const select = (table: Table, alias: string) => selectList(table, alias, columns);
      const now = this.options.now?.() ?? Date.now();
      const dump = emptyDump({ kind: 'wanderer-db', host: db.host, slug: db.slug, name: null }, now);

      onStep?.('map');
      const [map] = await query(`select ${select('maps_v1', 'm')} from maps_v1 m where m.slug = $1`, [
        db.slug,
      ]);
      if (!map || map.deleted === true) throw notFound(db);
      const mapId = String(map.id);
      dump.map = {
        name: text(map.name),
        slug: db.slug,
        description: text(map.description),
        scope: text(map.scope),
        scopes: Array.isArray(map.scopes)
          ? map.scopes.map(text).filter((s): s is string => s !== null)
          : null,
      };
      dump.source.name = dump.map.name;
      dump.systemLabels = readSystemLabels(map.system_labels);
      dump.labelNames = Object.fromEntries(dump.systemLabels.map((l) => [l.id, l.name]));

      onStep?.('systems');
      dump.systems = readAll(
        await query(
          `select ${select('map_system_v1', 's')} from map_system_v1 s where s.map_id = $1 order by s.solar_system_id`,
          [mapId],
        ),
        readSystem,
        'systems',
        dump.rejected,
      );

      onStep?.('connections');
      dump.connections = readAll(
        await query(
          `select ${select('map_chain_v1', 'c')} from map_chain_v1 c where c.map_id = $1 order by c.inserted_at, c.id`,
          [mapId],
        ),
        readConnection,
        'connections',
        dump.rejected,
      );

      onStep?.('signatures');
      const deleted = columns.get('map_system_signatures_v1')?.has('deleted')
        ? 'and not coalesce(g.deleted, false)'
        : '';
      dump.signatures = readAll(
        await query(
          `select ${select('map_system_signatures_v1', 'g')}, s.solar_system_id
             from map_system_signatures_v1 g join map_system_v1 s on s.id = g.system_id
            where s.map_id = $1 ${deleted}
            order by s.solar_system_id, g.eve_id`,
          [mapId],
        ),
        readSignature,
        'signatures',
        dump.rejected,
      );

      onStep?.('structures');
      dump.structures = readAll(
        await query(
          `select ${select('map_system_structures_v1', 't')}
             from map_system_structures_v1 t join map_system_v1 s on s.id = t.system_id
            where s.map_id = $1 order by t.inserted_at, t.id`,
          [mapId],
        ),
        readStructure,
        'structures',
        dump.rejected,
      );

      onStep?.('comments');
      dump.comments = readAll(
        await query(
          `select ${select('map_system_comments_v1', 'k')}, s.solar_system_id,
                  ch.eve_id as character_eve_id, ch.name as character_name
             from map_system_comments_v1 k join map_system_v1 s on s.id = k.system_id
             left join character_v1 ch on ch.id = k.character_id
            where s.map_id = $1 order by k.inserted_at, k.id`,
          [mapId],
        ),
        readComment,
        'comments',
        dump.rejected,
      );

      onStep?.('passages');
      dump.passages = columns.has('map_chain_passages_v1')
        ? readAll(
            await query(
              `select ${select('map_chain_passages_v1', 'p')}, ch.eve_id as character_eve_id
                 from map_chain_passages_v1 p left join character_v1 ch on ch.id = p.character_id
                where p.map_id = $1 order by p.inserted_at, p.id`,
              [mapId],
            ),
            readPassage,
            'passages',
            dump.rejected,
          )
        : [];

      onStep?.('access');
      dump.acls = await this.acls(query, select, mapId);

      onStep?.('hubs');
      // The map's own hubs first, then the ones its users set, most used first.
      const own = Array.isArray(map.hubs)
        ? map.hubs.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
        : [];
      const users = columns.has('map_user_settings_v1')
        ? readUserHubs(
            await query(
              `select ${select('map_user_settings_v1', 'u')} from map_user_settings_v1 u where u.map_id = $1`,
              [mapId],
            ),
            mapId,
          )
        : [];
      dump.hubs = [...new Set([...own, ...users])];

      onStep?.('webhooks');
      dump.webhooks = columns.has('map_webhook_subscriptions_v1')
        ? readAll(
            (
              await query(
                `select ${select('map_webhook_subscriptions_v1', 'w')} from map_webhook_subscriptions_v1 w where w.map_id = $1 order by w.url`,
                [mapId],
              )
            ).map((row) => ({ ...row, active: row['active?'] })),
            readWebhook,
            'webhooks',
            dump.rejected,
          )
        : [];

      if (columns.has('map_character_settings_v1')) {
        const [tracked] = await query(
          `select count(*) as n from map_character_settings_v1 t where t.map_id = $1 and t.tracked`,
          [mapId],
        );
        dump.trackedCharacters = Number(tracked?.n ?? 0);
      }
      return dump;
    });
  }

  private async acls(
    query: Query,
    select: (table: Table, alias: string) => string,
    mapId: string,
  ): Promise<WandererAcl[]> {
    const lists = await query(
      `select ${select('access_lists_v1', 'a')} from access_lists_v1 a
         join map_access_lists_v1 ma on ma.access_list_id = a.id
        where ma.map_id = $1 order by a.name, a.id`,
      [mapId],
    );
    if (lists.length === 0) return [];
    const members = await query(
      `select ${select('access_list_members_v1', 'am')} from access_list_members_v1 am
        where am.access_list_id = any($1::uuid[]) order by am.name`,
      [lists.map((l) => String(l.id))],
    );
    return lists.map((list) => ({
      id: String(list.id),
      name: text(list.name) ?? 'ACL',
      members: readAll(
        members.filter((m) => String(m.access_list_id) === String(list.id)),
        readAclMember,
        'access',
        {},
      ),
      error: null,
    }));
  }

  /**
   * One connection, one READ ONLY transaction with a statement timeout, rolled back at the end;
   * `work` gets a query function and the columns each of Wanderer's tables has.
   */
  private async session<T>(
    connectionString: string,
    work: (query: Query, columns: Columns) => Promise<T>,
  ): Promise<T> {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: this.options.connectTimeoutMs ?? 10_000,
      application_name: 'darkbeacon-import',
    });
    try {
      await client.connect();
    } catch (error) {
      throw connectFailure(error);
    }
    try {
      await client.query('begin transaction read only');
      await client.query(
        `set local statement_timeout = ${Math.round(this.options.statementTimeoutMs ?? 60_000)}`,
      );
      const query: Query = async (sql, values = []) => {
        try {
          return (await client.query(sql, values as unknown[])).rows as Row[];
        } catch (error) {
          throw queryFailure(error);
        }
      };
      const columns = await tableColumns(query);
      if (!columns.has('maps_v1') || !columns.has('map_system_v1'))
        throw new SourceError(
          'invalid',
          'This database has no Wanderer maps (no maps_v1 and map_system_v1 tables)',
        );
      return await work(query, columns);
    } finally {
      await client.query('rollback').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

type Query = (sql: string, values?: readonly unknown[]) => Promise<Row[]>;

/** Which of the known columns each of Wanderer's tables has (in the schema on the search path). */
async function tableColumns(query: Query): Promise<Columns> {
  const rows = await query(
    `select table_name, column_name from information_schema.columns
      where table_schema = any(current_schemas(false)) and table_name = any($1::text[])`,
    [Object.keys(COLUMNS)],
  );
  const out: Columns = new Map();
  for (const row of rows) {
    const table = String(row.table_name) as Table;
    let set = out.get(table);
    if (!set) out.set(table, (set = new Set()));
    set.add(String(row.column_name));
  }
  return out;
}

/** `alias."column"` for each known column, null for the ones this database lacks; times as UTC ISO. */
function selectList(table: Table, alias: string, columns: Columns): string {
  const present = columns.get(table) ?? new Set<string>();
  return COLUMNS[table]
    .map((column) => {
      const name = `"${column}"`;
      if (!present.has(column)) return `null as ${name}`;
      if (TIME_COLUMNS.has(column))
        return `to_char(${alias}.${name}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${name}`;
      if (column === 'id' || column.endsWith('_id') || column === 'eve_id')
        return `${alias}.${name}::text as ${name}`;
      return `${alias}.${name}`;
    })
    .join(', ');
}

function asDb(request: SourceRequest): WandererDbRequest {
  if (request.kind !== 'wanderer-db') throw new Error('not a database source');
  return request;
}

function notFound(db: WandererDbRequest): SourceError {
  return new SourceError('not_found', `This Wanderer database has no map “${db.slug}”`);
}

/** A connection that did not open, in words (never the connection string). */
function connectFailure(error: unknown): SourceError {
  const e = error as { code?: string; message?: string };
  if (e.code === '28P01' || e.code === '28000')
    return new SourceError('auth', 'The database refused the user or password in the connection string');
  if (e.code === '3D000')
    return new SourceError('not_found', 'The database named in the connection string does not exist');
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN')
    return new SourceError('unavailable', 'The database host in the connection string is not known here');
  return new SourceError('unavailable', `The database did not answer (${e.code ?? 'no connection'})`);
}

function queryFailure(error: unknown): SourceError {
  const e = error as { code?: string; message?: string };
  if (e.code === '57014')
    return new SourceError('unavailable', 'Reading the database took too long; try again');
  if (e.code === '42501') return new SourceError('auth', 'The database user may not read Wanderer’s tables');
  return new SourceError('invalid', `The database did not answer like Wanderer’s (${e.code ?? 'error'})`);
}
