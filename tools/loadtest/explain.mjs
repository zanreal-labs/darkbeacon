// EXPLAIN QUERY PLAN of the hot queries on a seeded SQLite database (see docs/scaling.md).
// Runs in the application image against the volume the seed wrote to:
//   node apps/server/loadtest/explain.mjs /data/app.db
import SQLite from 'better-sqlite3';

const db = new SQLite(process.argv[2] ?? '/data/app.db', { readonly: true });
const queries = {
  'event_log replay': `select * from event_log where stream = ? and seq > ? order by seq limit 500`,
  'event_log oldest': `select min(seq) from event_log where stream = ?`,
  'consumer cursors': `select es.stream, es.head_seq, o.seq from event_stream es left join event_consumer_offset o
     on o.stream = es.stream and o.consumer = ? where es.stream in (?, ?)`,
  'systems of a map': `select * from map_systems where map_id = ? order by solar_system_id`,
  'system on a map': `select * from map_systems where map_id = ? and solar_system_id = ?`,
  'connections of a map': `select * from map_connections where map_id = ? order by id`,
  'connection between two systems': `select * from map_connections where map_id = ? and pair_low = ? and pair_high = ?`,
  'connections of a system': `select * from map_connections where map_id = ? and (source = ? or target = ?)`,
  'signatures of a map': `select * from map_signatures where map_id = ?`,
  'signatures of a system': `select * from map_signatures where map_id = ? and solar_system_id = ?`,
  'tracked on a map': `select * from tracked_character where map_id = ?`,
  'tracked character on a map': `select * from tracked_character where map_id = ? and character_id = ?`,
  'presence of characters': `select * from character_presence where character_id in (?, ?, ?)`,
  'access rules of a map': `select * from access_rule where map_id = ? order by created_at, id`,
  'rules matching subjects': `select * from access_rule where (subject_kind = ? and subject_id in (?, ?))`,
  session: `select * from session where id = ?`,
  'characters of an account': `select * from eve_character where account_id = ?`,
  'history of a map': `select * from event_log where stream = ? and occurred_at < ? order by occurred_at desc limit 50`,
  'history of a thing': `select e.* from event_ref r join event_log e on e.stream = r.stream and e.seq = r.seq
     where r.ref = ? order by r.occurred_at desc limit 50`,
};
for (const [name, sql] of Object.entries(queries)) {
  const plan = db
    .prepare(`explain query plan ${sql}`)
    .all(...Array.from(sql.matchAll(/\?/g), () => 'x'))
    .map((r) => r.detail)
    .join('; ');
  console.log(`${name.padEnd(32)} ${plan}`);
}
