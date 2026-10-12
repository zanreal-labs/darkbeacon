// Seed generator for load tests: a whole alliance on one instance. Writes accounts, linked
// characters with (fake) ESI tokens, sessions, maps with big chains and signatures, access rules
// and tracked characters straight into the database, then the fixture the other tools read
// (session tokens, map ids, chains, who is tracked and online).
//
// Runs in the application image (it uses the app's own database code and token sealing), with
// this directory mounted at /app/apps/server/loadtest:
//   node apps/server/loadtest/seed.mjs            (DATABASE_URL or DATA_DIR, SECRET_KEY, OUT)
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { newId } from '@darkbeacon/core';
import { createDatabase, json } from '@darkbeacon/db';
import { SecretBox } from '../dist/adapters/identity/secret-box.js';

const env = (name, fallback) => (process.env[name] === undefined ? fallback : Number(process.env[name]));
const size = {
  accounts: env('ACCOUNTS', 3000),
  charactersPerAccount: env('CHARACTERS_PER_ACCOUNT', 2),
  maps: env('MAPS', 50),
  systems: env('SYSTEMS', 500),
  connections: env('CONNECTIONS', 1000),
  signaturesPerSystem: env('SIGNATURES_PER_SYSTEM', 2),
  tracked: env('TRACKED', 1500),
  online: env('ONLINE', 600),
  /** Share of tracked characters tracked on the main map; the rest spread over the others. */
  mainShare: env('MAIN_SHARE', 0.4),
};
const secretKey = process.env.SECRET_KEY;
if (!secretKey) throw new Error('SECRET_KEY is required (the app must open the tokens)');
const out = process.env.OUT ?? '/out/fixture.json';

// Deterministic: the same SEED gives the same instance.
let state = env('SEED', 1) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const token = () => randomBytes(32).toString('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest('base64url');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const sigId = () =>
  `${pick(LETTERS)}${pick(LETTERS)}${pick(LETTERS)}-${String(Math.floor(random() * 1000)).padStart(3, '0')}`;

const universe = JSON.parse(
  readFileSync(new URL('../../../packages/sde/data/universe.json', import.meta.url)),
);
const wormholes = universe.systems.filter((s) => s.whClass >= 1 && s.whClass <= 6).map((s) => s.id);
const kspace = universe.systems.filter((s) => s.whClass >= 7 && s.whClass <= 9).map((s) => s.id);

const started = Date.now();
const now = Date.now();
const database = await createDatabase({
  url: process.env.DATABASE_URL,
  dataDir: process.env.DATA_DIR ?? '/data',
});
await database.migrate();
const db = database.kysely;
const eveTokens = new SecretBox(secretKey, 'eve-tokens');

async function insert(table, rows, chunk = 400) {
  for (let i = 0; i < rows.length; i += chunk)
    await db
      .insertInto(table)
      .values(rows.slice(i, i + chunk))
      .execute();
}

const ALLIANCE = 99_000_001;
const SCOPES = json.encode([
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-search.search_structures.v1',
]);

// ---- accounts, characters, sessions
const accounts = [];
const accountRows = [];
const characterRows = [];
const tokenRows = [];
const sessionRows = [];
let characterId = 2_120_000_000;
for (let i = 0; i < size.accounts; i++) {
  const id = newId();
  const characterIds = [];
  for (let c = 0; c < size.charactersPerAccount; c++) {
    const cid = characterId++;
    characterIds.push(cid);
    characterRows.push({
      id: cid,
      account_id: id,
      name: `Pilot ${String(i).padStart(4, '0')}${c === 0 ? '' : ` Alt ${c}`}`,
      corporation_id: 98_000_001 + (i % 40),
      alliance_id: ALLIANCE,
      owner_hash: sha256(`owner-${cid}`),
      token_valid: 1,
      linked_at: now,
      updated_at: now,
    });
    tokenRows.push({
      character_id: cid,
      access_token: eveTokens.seal(`fake:${cid}`),
      refresh_token: eveTokens.seal(`refresh:${cid}`),
      // Far in the future: the app never asks EVE SSO to refresh during a run.
      expires_at: Date.UTC(2100, 0, 1),
      scopes: SCOPES,
    });
  }
  accountRows.push({
    id,
    discord_id: null,
    name: `Pilot ${String(i).padStart(4, '0')}`,
    avatar_url: null,
    instance_role: i === 0 ? 'owner' : 'user',
    main_character_id: characterIds[0],
    default_map_id: null,
    recent_map_ids: json.encode([]),
    created_at: now,
    updated_at: now,
    last_seen_at: now,
  });
  const session = token();
  sessionRows.push({
    id: sha256(session),
    account_id: id,
    created_at: now,
    expires_at: now + 30 * 24 * 3_600_000,
    last_seen_at: now,
    user_agent: 'darkbeacon-loadtest',
  });
  accounts.push({ id, session, characterIds });
}

// ---- maps with big chains
const maps = [];
const mapRows = [];
const ruleRows = [];
const systemRows = [];
const connectionRows = [];
const signatureRows = [];
const owner = accounts[0].id;
for (let m = 0; m < size.maps; m++) {
  const id = newId();
  const slug = m === 0 ? 'alliance-main' : `chain-${String(m).padStart(2, '0')}`;
  mapRows.push({
    id,
    slug,
    name: m === 0 ? 'Alliance main' : `Chain ${m}`,
    owner_account_id: owner,
    settings: json.encode({ scopes: ['wormhole'] }),
    labels: json.encode([]),
    created_at: now,
    updated_at: now,
  });
  ruleRows.push({
    id: newId(),
    map_id: id,
    subject_kind: 'alliance',
    subject_id: String(ALLIANCE),
    guild_id: null,
    role: 'member',
    created_at: now,
    created_by: owner,
  });
  // A few personal rules, as real maps collect them.
  for (let r = 0; r < 20; r++) {
    ruleRows.push({
      id: newId(),
      map_id: id,
      subject_kind: 'character',
      subject_id: String(accounts[1 + ((m * 20 + r) % (accounts.length - 1))].characterIds[0]),
      guild_id: null,
      role: 'manager',
      created_at: now,
      created_by: owner,
    });
  }

  // 80 % wormhole space, 20 % known space, laid out as a tree with extra links.
  const systems = shuffle([
    ...shuffle(wormholes).slice(0, Math.round(size.systems * 0.8)),
    ...shuffle(kspace).slice(0, size.systems - Math.round(size.systems * 0.8)),
  ]);
  const depth = new Map([[systems[0], 0]]);
  const children = new Map();
  const edges = [];
  const pairs = new Set();
  const link = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a === b || pairs.has(key)) return false;
    pairs.add(key);
    edges.push([a, b]);
    return true;
  };
  for (let i = 1; i < systems.length; i++) {
    const parent = systems[Math.floor(random() ** 1.5 * i)];
    depth.set(systems[i], depth.get(parent) + 1);
    children.set(parent, (children.get(parent) ?? 0) + 1);
    link(parent, systems[i]);
  }
  while (edges.length < size.connections) link(pick(systems), pick(systems));

  const slot = new Map();
  systems.forEach((s, i) => {
    const d = depth.get(s);
    const row = slot.get(d) ?? 0;
    slot.set(d, row + 1);
    systemRows.push({
      map_id: id,
      solar_system_id: s,
      x: d * 360,
      y: row * 150,
      custom_name: null,
      temporary_name: null,
      tag: null,
      status: i === 0 ? 'home' : pick(['unknown', 'unknown', 'empty', 'friendly', 'occupied']),
      description: '',
      label_ids: json.encode([]),
      locked: 0,
      visible: 1,
      created_at: now,
      updated_at: now,
    });
    for (let g = 0; g < size.signaturesPerSystem; g++) {
      signatureRows.push({
        id: newId(),
        map_id: id,
        solar_system_id: s,
        eve_id: sigId(),
        sig_group: pick(['wormhole', 'combat', 'data', 'relic', 'unknown']),
        type: null,
        name: null,
        description: '',
        connection_id: null,
        created_at: now,
        updated_at: now,
      });
    }
  });
  for (const [a, b] of edges) {
    connectionRows.push({
      id: newId(),
      map_id: id,
      source: a,
      target: b,
      type: 'wormhole',
      time_status: random() < 0.1 ? 'eol' : 'normal',
      mass_status: pick(['fresh', 'fresh', 'fresh', 'reduced', 'critical']),
      ship_size: 'large',
      mass_saved: 0,
      dangerous: random() < 0.03 ? 1 : 0,
      bubbled: 'none',
      eol_at: null,
      mass_status_at: null,
      created_at: now,
      updated_at: now,
      pair_low: Math.min(a, b),
      pair_high: Math.max(a, b),
    });
  }
  maps.push({ id, slug, systems, edges });
}

// ---- tracking: who is tracked where, who is online
const trackedRows = [];
const presenceRows = [];
const tracking = [];
const trackedAccounts = shuffle(accounts.slice(1)).slice(0, size.tracked);
trackedAccounts.forEach((account, i) => {
  const characterId = account.characterIds[0];
  const main = random() < size.mainShare;
  const mapIndexes = [main ? 0 : 1 + Math.floor(random() * (maps.length - 1))];
  // One in ten is tracked on a second map as well.
  if (random() < 0.1)
    mapIndexes.push((mapIndexes[0] + 1 + Math.floor(random() * (maps.length - 1))) % maps.length);
  const systemId = pick(maps[mapIndexes[0]].systems);
  const isOnline = i < size.online;
  for (const index of mapIndexes) {
    trackedRows.push({
      map_id: maps[index].id,
      character_id: characterId,
      account_id: account.id,
      since: now - i,
    });
  }
  presenceRows.push({
    character_id: characterId,
    account_id: account.id,
    name: characterRows.find((c) => c.id === characterId).name,
    solar_system_id: systemId,
    ship_type_id: 11182,
    ship_name: 'Probe',
    online: isOnline ? 1 : 0,
    updated_at: now,
  });
  tracking.push({
    characterId,
    accountId: account.id,
    mapIds: mapIndexes.map((index) => maps[index].id),
    systemId,
    online: isOnline,
  });
});

await insert('account', accountRows);
await insert('eve_character', characterRows);
await insert('eve_character_token', tokenRows);
await insert('session', sessionRows);
await insert('maps', mapRows);
await insert('access_rule', ruleRows);
await insert('map_systems', systemRows);
await insert('map_connections', connectionRows);
await insert('map_signatures', signatureRows);
await insert('tracked_character', trackedRows);
await insert('character_presence', presenceRows);
await database.close();

const used = new Set(maps.flatMap((m) => m.systems));
const spareSystems = shuffle(wormholes.filter((s) => !used.has(s))).slice(0, 2000);
writeFileSync(out, JSON.stringify({ size, accounts, maps, tracking, spareSystems }));
console.log(
  `seeded ${accountRows.length} accounts, ${characterRows.length} characters, ${mapRows.length} maps, ` +
    `${systemRows.length} systems, ${connectionRows.length} connections, ${signatureRows.length} signatures, ` +
    `${trackedRows.length} tracked (${size.online} online) in ${Date.now() - started} ms`,
);
