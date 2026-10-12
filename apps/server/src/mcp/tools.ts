import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { AuditTrail } from '@darkbeacon/audit';
import {
  NotFoundError,
  ValidationError,
  grantOf,
  isDomainError,
  mapStream,
  type Actor,
  type CredentialGrant,
} from '@darkbeacon/core';
import type {
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  UniverseCatalog,
} from '@darkbeacon/mapping';
import type { RouteQueries } from '@darkbeacon/routing';
import type { MapPublishing, PublicAccess } from '@darkbeacon/publishing';
import {
  API_VERSION,
  RouteMode,
  RouteSkip,
  SignatureEveId,
  SignatureGroup,
  scopesAllow,
  type CharacterPresenceDto,
  type ConnectionDto,
  type MapExitDto,
  type MapSystemDto,
  type ScopeRequirement,
  type SignatureDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import type { MergedWriteRouter } from '../modules/mapping/merged-writes.js';
import type { RealtimeHub } from '../realtime/realtime.hub.js';
import {
  characterLine,
  connectionLine,
  exitLine,
  intelLine,
  oneLine,
  page,
  routeText,
  securityLabel,
  short,
  signatureLine,
  staticsLabel,
  systemLine,
  systemName,
} from './format.js';

/** Who is calling: an API key (as its principal), or an anonymous agent (public maps only). */
export type McpCaller = { kind: 'key'; actor: Actor; grant: CredentialGrant } | { kind: 'anonymous' };

export interface McpDeps {
  maps: MapUseCases;
  systems: SystemUseCases;
  connections: ConnectionUseCases;
  signatures: SignatureUseCases;
  intel: ConnectionIntelQuery;
  routes: RouteQueries;
  audit: AuditTrail;
  hub: RealtimeHub;
  universe: UniverseCatalog;
  /**
   * Writes on a map that merges others (a composite, or a map that accepted shares) go through
   * sharing's write-through to the maps holding the objects, like the REST routes.
   */
  merged: MergedWriteRouter;
  /** Public maps; without the publishing module anonymous agents see nothing. */
  publishing: MapPublishing | null;
}

/** A map as a tool sees it: who reads it, and how much of it the caller may see. */
interface MapView {
  mapId: string;
  name: string;
  /** The `map` value tools take back (map id for keys, the public link for anonymous agents). */
  ref: string;
  systems: MapSystemDto[];
  connections: ConnectionDto[];
  exits: MapExitDto[];
  signatures: SignatureDto[] | null;
  characters: CharacterPresenceDto[] | null;
  connectionStatus: boolean;
  /** Anonymous: the public link it came through. */
  share: PublicAccess | null;
}

class ToolError extends Error {}

/** A write on a map that merges others lands on the maps holding the object; it shows up shortly. */
const MERGED = '(written to the maps this one merges)';

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const failure = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

const MapArg = z
  .string()
  .min(1)
  .max(80)
  .describe('The map: its id or slug (with an API key), or the public link id from list_maps (anonymous)');
const SystemArg = z.string().min(1).max(64).describe('A solar system: name (J123456, Jita) or id');
const Cursor = z.string().max(64).optional().describe('`next` from the previous page');
const Limit = z.number().int().min(1).max(200).optional();

export const MCP_INSTRUCTIONS = `Darkbeacon is an EVE Online wormhole mapper. Maps hold a chain: systems (wormhole and known space) linked by connections (wormholes with mass and time status, gates, bridges).
Start with list_maps, then get_map for a compact summary of a chain. Systems are named by name (J-codes, Jita); ids in output (connection, signature) are short ids that tools take back.
Mass: fresh > 50 %, reduced 10-50 %, critical < 10 %. EOL: under 4 h left. Exits are known-space systems the chain reaches, with jumps to trade hubs.
Writes need an API key with write scopes and are recorded in the map history as made through MCP.`;

/**
 * The MCP server for one request (the transport is stateless): tools mirror the use cases and
 * run as the caller, so the same authorization applies; API keys also need the scope of each
 * tool, anonymous agents only read public maps through their projection.
 */
export function buildMcpServer(deps: McpDeps, caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: 'darkbeacon', version: API_VERSION },
    { instructions: MCP_INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  const anonymous = caller.kind === 'anonymous';
  const grant = caller.kind === 'key' ? caller.grant : null;
  const actor = caller.kind === 'key' ? caller.actor : null;

  /** Throws unless the key's scopes allow the requirement on the map. */
  const need = (requirement: ScopeRequirement, mapId: string | null) => {
    if (!grant) throw new ToolError('This needs an API key (Authorization: Bearer dbk_…)');
    if (!scopesAllow(grant.scopes, requirement, mapId, grant.readOnly)) {
      const name =
        typeof requirement === 'object' ? `${requirement.resource}:${requirement.action}` : requirement;
      throw new ToolError(`This API key lacks the scope ${name}${mapId ? ' on this map' : ''}`);
    }
  };
  const may = (requirement: ScopeRequirement, mapId: string | null) =>
    !!grant && scopesAllow(grant.scopes, requirement, mapId, grant.readOnly);
  const canWrite = !!grant && !grant.readOnly && grant.scopes.some((s) => !s.endsWith(':read'));

  const run =
    <A>(work: (args: A) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) =>
    async (args: A) => {
      try {
        return await work(args);
      } catch (error) {
        if (error instanceof ToolError) return failure(error.message);
        if (isDomainError(error)) return failure(error.message);
        throw error;
      }
    };

  const resolveSystem = (input: string): number => {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed) && deps.universe.getSystem(Number(trimmed))) return Number(trimmed);
    const exact = deps.universe
      .searchSystems(trimmed, 5)
      .find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (!exact) throw new ToolError(`No solar system named ${trimmed}; try find_system`);
    return exact.id;
  };

  /** Loads a map for the caller: through the use cases (keys) or the public projection. */
  /** `forWrite`: the tool writes and checks its own write scope, so `maps:read` is not needed. */
  const loadMap = async (ref: string, forWrite = false): Promise<MapView> => {
    if (anonymous) {
      const access = deps.publishing ? await deps.publishing.resolve(ref) : null;
      const agents = access
        ? (await deps.publishing!.publicForAgents()).some((a) => a.share.mapId === access.share.mapId)
        : false;
      if (!access || !agents) throw new ToolError('No such public map for agents; see list_maps');
      const view = await deps.publishing!.view(access);
      return {
        mapId: access.share.mapId,
        name: view.map.name,
        ref,
        systems: view.snapshot.systems,
        connections: view.snapshot.connections,
        exits: view.snapshot.exits ?? [],
        signatures: view.snapshot.signatures ?? null,
        characters: view.snapshot.characters ?? null,
        connectionStatus: access.scopes.has('connectionStatus'),
        share: access,
      };
    }
    const map = await deps.maps.get(actor, ref).catch(async (error: unknown) => {
      if (isDomainError(error) && error.code === 'not_found') return deps.maps.getBySlug(actor, ref);
      throw error;
    });
    if (deps.publishing && (await deps.publishing.mcpModeFor(map.id)) === 'off')
      throw new ToolError('This map is closed to AI agents (Map settings, Public link)');
    if (!forWrite) need({ resource: 'maps', action: 'read' }, map.id);
    const { data } = await deps.hub.readSnapshot(mapStream(map.id), actor);
    const list = <T>(key: string) => (Array.isArray(data[key]) ? (data[key] as T[]) : []);
    return {
      mapId: map.id,
      name: map.name,
      ref: map.id,
      // What people wrote about systems (notes, status, tags, names, locks) is what
      // `systems:read` reads; `maps:read` alone sees the shape of the chain.
      systems: may({ resource: 'systems', action: 'read' }, map.id)
        ? list<MapSystemDto>('systems')
        : list<MapSystemDto>('systems').map((sys) => ({
            ...sys,
            description: '',
            tag: null,
            customName: null,
            temporaryName: null,
            locked: false,
            labelIds: [],
            status: 'unknown' as const,
          })),
      connections: may({ resource: 'connections', action: 'read' }, map.id)
        ? list<ConnectionDto>('connections')
        : [],
      exits: may({ resource: 'routes', action: 'read' }, map.id) ? list<MapExitDto>('exits') : [],
      signatures: may({ resource: 'signatures', action: 'read' }, map.id)
        ? list<SignatureDto>('signatures')
        : null,
      characters: may({ resource: 'tracking', action: 'read' }, map.id)
        ? list<CharacterPresenceDto>('characters')
        : null,
      connectionStatus: true,
      share: null,
    };
  };

  const byShortId = <T extends { id: string }>(items: readonly T[], id: string, what: string): T => {
    const exact = items.find((i) => i.id === id);
    if (exact) return exact;
    const found = items.filter((i) => i.id.endsWith(id));
    if (found.length === 0) throw new ToolError(`No ${what} with id ${id} on this map`);
    if (found.length > 1) throw new ToolError(`Several ${what}s end with ${id}; give the whole id`);
    return found[0]!;
  };

  // ---- reading ----------------------------------------------------------------------------

  server.registerTool(
    'list_maps',
    {
      title: 'List maps',
      description: anonymous
        ? 'Public maps this instance opens to AI agents.'
        : 'Maps this API key can read, with your role on each.',
      inputSchema: z.object({ cursor: Cursor, limit: Limit }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ cursor, limit }) => {
      if (anonymous) {
        const shared = deps.publishing ? await deps.publishing.publicForAgents() : [];
        const views = await Promise.all(shared.map(async (a) => ({ a, v: await deps.publishing!.view(a) })));
        const lines = views.map(
          ({ a, v }) =>
            `${v.map.name} | map ${a.share.slug ?? a.share.token} | ${v.snapshot.systems.length} systems | shows ${a.share.scopes.join(',')}`,
        );
        const p = page(lines, cursor, limit ?? 50);
        return text(
          lines.length
            ? [...p.items, ...(p.next ? [`next ${p.next}`] : [])].join('\n')
            : 'No public maps are open to agents.',
        );
      }
      need({ resource: 'maps', action: 'read' }, null);
      const maps = await deps.maps.list(actor);
      const open = [];
      for (const m of maps)
        if (!deps.publishing || (await deps.publishing.mcpModeFor(m.id)) !== 'off') open.push(m);
      const p = page(open, cursor, limit ?? 50);
      const lines = p.items.map((m) => `${m.name} | map ${m.id} | slug ${m.slug} | role ${m.role}`);
      return text([...lines, ...(p.next ? [`next ${p.next}`] : [])].join('\n') || 'No maps.');
    }),
  );

  server.registerTool(
    'get_map',
    {
      title: 'Map summary',
      description:
        'Compact summary of a chain: systems with class, statics and status, connections with mass/time, exits and who is where (when the key may see it).',
      inputSchema: z.object({ map: MapArg }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ map }) => {
      const view = await loadMap(map);
      const here = new Map<number, number>();
      for (const c of view.characters ?? [])
        if (c.online && c.solarSystemId) here.set(c.solarSystemId, (here.get(c.solarSystemId) ?? 0) + 1);
      const sigs = new Map<number, number>();
      for (const s of view.signatures ?? []) sigs.set(s.solarSystemId, (sigs.get(s.solarSystemId) ?? 0) + 1);
      const lines = [
        `Map "${view.name}" (map ${view.ref}): ${view.systems.length} systems, ${view.connections.length} connections.`,
        'Systems:',
        ...view.systems.map(
          (s) =>
            `- ${systemLine(deps.universe, s, [
              ...(view.signatures ? [`sigs ${sigs.get(s.solarSystemId) ?? 0}`] : []),
              ...(here.get(s.solarSystemId) ? [`pilots ${here.get(s.solarSystemId)}`] : []),
            ])}`,
        ),
        'Connections:',
        ...view.connections.map((c) => `- ${connectionLine(deps.universe, c, view.connectionStatus)}`),
      ];
      if (view.exits.length) lines.push('Exits:', ...view.exits.map((e) => `- ${exitLine(e)}`));
      if (!view.connectionStatus) lines.push('(Connection mass and time are not shared on this public map.)');
      return text(lines.join('\n'));
    }),
  );

  server.registerTool(
    'find_system',
    {
      title: 'Find a solar system',
      description: 'Search solar systems by name (prefix first). Optionally tell whether each is on a map.',
      inputSchema: z.object({
        query: z.string().min(1).max(64),
        map: MapArg.optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ query, map, limit }) => {
      if (grant) need({ resource: 'universe', action: 'read' }, null);
      const found = deps.universe.searchSystems(query, limit ?? 10);
      const on = map ? new Set((await loadMap(map)).systems.map((s) => s.solarSystemId)) : null;
      if (found.length === 0) return text(`No system matches "${query}".`);
      return text(
        found
          .map((s) =>
            [
              s.name,
              `[${securityLabel(s)}]`,
              s.regionName,
              staticsLabel(deps.universe, s),
              on ? (on.has(s.id) ? 'on map' : 'not on map') : '',
            ]
              .filter(Boolean)
              .join(' | '),
          )
          .join('\n'),
      );
    }),
  );

  server.registerTool(
    'get_system_intel',
    {
      title: 'System intel',
      description:
        'Class, security, region, statics with destinations, wormhole effect; on a map also status, notes, signatures and pilots where the caller may see them. Kills are not tracked by Darkbeacon.',
      inputSchema: z.object({ system: SystemArg, map: MapArg.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ system, map }) => {
      const id = resolveSystem(system);
      const info = deps.universe.getSystem(id)!;
      const lines = [
        `${info.name} [${securityLabel(info)}] region ${info.regionName}, constellation ${info.constellationName}`,
      ];
      for (const code of info.statics) {
        const type = deps.universe.wormholeType(code);
        if (!type) continue;
        lines.push(
          `static ${code}: to ${type.destination ?? '?'}, ${type.lifetimeHours ?? '?'}h, total ${type.totalMass ? Math.round(type.totalMass / 1e6) : '?'}kt, jump ${type.maxJumpMass ? Math.round(type.maxJumpMass / 1e6) : '?'}kt, fits ${type.fits.join(',') || '?'}`,
        );
      }
      if (info.effect) lines.push(`effect ${info.effect}`);
      if (map) {
        const view = await loadMap(map);
        const onMap = view.systems.find((s) => s.solarSystemId === id);
        if (!onMap) lines.push('Not on this map.');
        else {
          lines.push(`On map: ${systemLine(deps.universe, onMap)}`);
          const links = view.connections.filter((c) => c.source === id || c.target === id);
          for (const c of links) lines.push(`- ${connectionLine(deps.universe, c, view.connectionStatus)}`);
          const sigs = (view.signatures ?? []).filter((s) => s.solarSystemId === id);
          if (view.signatures)
            lines.push(`Signatures (${sigs.length}):`, ...sigs.map((s) => `- ${signatureLine(s)}`));
          const pilots = (view.characters ?? []).filter((c) => c.solarSystemId === id);
          if (view.characters && pilots.length)
            lines.push('Pilots:', ...pilots.map((c) => `- ${characterLine(deps.universe, c)}`));
        }
      }
      return text(lines.join('\n'));
    }),
  );

  server.registerTool(
    'list_connections',
    {
      title: 'Connections',
      description:
        'Every connection of a map, most urgent first, with mass left, time left (upper bounds), size and which hulls fit.',
      inputSchema: z.object({ map: MapArg, cursor: Cursor, limit: Limit }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ map, cursor, limit }) => {
      const view = await loadMap(map);
      if (anonymous) {
        // The public projection only; estimates read signatures and passages, which a link may not share.
        const p = page(view.connections, cursor, limit ?? 50);
        return text(
          [
            ...p.items.map((c) => connectionLine(deps.universe, c, view.connectionStatus)),
            ...(p.next ? [`next ${p.next}`] : []),
          ].join('\n') || 'No connections.',
        );
      }
      need({ resource: 'connections', action: 'read' }, view.mapId);
      const intel = await deps.intel.list(actor, view.mapId);
      const p = page(intel, cursor, limit ?? 50);
      return text(
        [...p.items.map(intelLine), ...(p.next ? [`next ${p.next}`] : [])].join('\n') || 'No connections.',
      );
    }),
  );

  server.registerTool(
    'find_route',
    {
      title: 'Find a route',
      description:
        'Route over stargates and the chain. Modes: shortest, safer (avoids low/null), highsec, outlaw (never enters high-sec), pilot (avoids where faction police shoot the pilot; give securityStatus).',
      inputSchema: z.object({
        map: MapArg,
        from: SystemArg,
        to: SystemArg,
        mode: RouteMode.optional(),
        skip: z
          .array(RouteSkip)
          .max(3)
          .optional()
          .describe('Chain connections to avoid: eol, critical, frigate'),
        avoid: z.array(SystemArg).max(50).optional(),
        securityStatus: z.number().min(-10).max(10).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ map, from, to, mode, skip, avoid, securityStatus }) => {
      const view = await loadMap(map);
      if (!anonymous) need({ resource: 'routes', action: 'read' }, view.mapId);
      if (anonymous && skip?.length && !view.connectionStatus)
        throw new ToolError('This public map does not share connection status, so routes cannot skip by it');
      const routeActor = anonymous ? view.share!.actor : actor;
      const route = await deps.routes.route(routeActor, view.mapId, {
        from: resolveSystem(from),
        to: resolveSystem(to),
        mode: mode ?? 'shortest',
        ...(skip ? { skip } : {}),
        ...(avoid ? { avoid: avoid.map(resolveSystem) } : {}),
        ...(securityStatus !== undefined ? { securityStatus } : {}),
      });
      return text(routeText(route));
    }),
  );

  server.registerTool(
    'nearest_hub',
    {
      title: 'Ways out and nearest hub',
      description:
        "The chain's exits (known space it reaches) with jumps to the trade hubs, nearest first; with `from`, jumps from that system to every hub.",
      inputSchema: z.object({ map: MapArg, from: SystemArg.optional(), mode: RouteMode.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ map, from, mode }) => {
      const view = await loadMap(map);
      if (anonymous) {
        if (from) throw new ToolError('Anonymous agents get the exits of the map; ask without `from`');
        const sorted = [...view.exits].sort((a, b) => (a.nearest?.jumps ?? 1e9) - (b.nearest?.jumps ?? 1e9));
        return text(sorted.map(exitLine).join('\n') || 'No exits known.');
      }
      need({ resource: 'routes', action: 'read' }, view.mapId);
      if (from) {
        const hubs = await deps.routes.hubDistances(actor, view.mapId, {
          from: resolveSystem(from),
          mode: mode ?? 'shortest',
        });
        return text(
          hubs
            .map((h) => `${h.name} (${h.kind}) ${h.jumps ?? 'no route'}${h.jumps !== null ? 'j' : ''}`)
            .join('\n') || 'No hubs.',
        );
      }
      const { exits } = await deps.routes.exits(actor, view.mapId, { mode: mode ?? 'shortest' });
      const sorted = [...exits].sort((a, b) => (a.nearest?.jumps ?? 1e9) - (b.nearest?.jumps ?? 1e9));
      return text(sorted.map(exitLine).join('\n') || 'No exits known.');
    }),
  );

  server.registerTool(
    'list_signatures',
    {
      title: 'Signatures of a system',
      description: 'Cosmic signatures scanned in one system of the map.',
      inputSchema: z.object({ map: MapArg, system: SystemArg }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    run(async ({ map, system }) => {
      const view = await loadMap(map);
      const id = resolveSystem(system);
      if (anonymous) {
        if (!view.signatures) throw new ToolError('This public map does not share signatures');
        const sigs = view.signatures.filter((s) => s.solarSystemId === id);
        return text(sigs.map(signatureLine).join('\n') || 'No signatures.');
      }
      need({ resource: 'signatures', action: 'read' }, view.mapId);
      const sigs = await deps.signatures.list(actor, view.mapId, id);
      return text(sigs.map(signatureLine).join('\n') || 'No signatures.');
    }),
  );

  if (!anonymous) {
    server.registerTool(
      'get_recent_history',
      {
        title: 'Recent changes',
        description: 'Latest changes on the map: who changed what, newest first.',
        inputSchema: z.object({
          map: MapArg,
          system: SystemArg.optional(),
          cursor: Cursor,
          limit: z.number().int().min(1).max(100).optional(),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      run(async ({ map, system, cursor, limit }) => {
        const view = await loadMap(map);
        need({ resource: 'audit', action: 'read' }, view.mapId);
        const result = await deps.audit.mapHistory(actor, view.mapId, {
          limit: limit ?? 30,
          ...(cursor ? { before: cursor } : {}),
          ...(system ? { solarSystemId: resolveSystem(system) } : {}),
        });
        const lines = result.entries.map((e) => {
          const who = e.actor.characterName ?? e.actor.accountName ?? e.actor.kind;
          const via =
            e.channel.kind === 'mcp' || e.channel.kind === 'api'
              ? ` via ${e.channel.kind}${e.channel.name ? ` (${e.channel.name})` : ''}`
              : '';
          const what = e.entity
            ? `${e.entity.kind} ${e.entity.kind === 'system' ? systemName(deps.universe, Number(e.entity.id)) : short(e.entity.id)}`
            : '';
          const fields = Object.keys(e.diff).slice(0, 6).join(',');
          return `${new Date(e.occurredAt).toISOString().slice(0, 16)}Z ${who}${via}: ${e.type} ${what}${fields ? ` [${fields}]` : ''}`;
        });
        return text(
          [...lines, ...(result.nextCursor ? [`next ${result.nextCursor}`] : [])].join('\n') || 'No changes.',
        );
      }),
    );
  }

  // ---- writing (API keys with write scopes only) -------------------------------------------

  if (canWrite) {
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

    server.registerTool(
      'add_signature',
      {
        title: 'Add a signature',
        description: 'Record a scanned signature in a system of the map.',
        inputSchema: z.object({
          map: MapArg,
          system: SystemArg,
          eveId: SignatureEveId.describe('In-game id such as ABC-123'),
          group: SignatureGroup.optional(),
          type: z.string().max(64).optional().describe('Wormhole type code (B274) or site type'),
          name: z.string().max(128).optional(),
          description: z.string().max(2000).optional(),
        }),
        annotations: write,
      },
      run(async ({ map, system, eveId, group, type, name, description }) => {
        const view = await loadMap(map, true);
        need({ resource: 'signatures', action: 'write' }, view.mapId);
        const id = resolveSystem(system);
        const request = {
          eveId,
          ...(group ? { group } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        };
        const sig = await deps.merged.route(
          view.mapId,
          (w) => w.addSignature(actor, view.mapId, id, request),
          () => deps.signatures.add(actor, view.mapId, id, request),
        );
        return text(sig ? `Added ${signatureLine(sig)}` : `Added ${eveId} ${MERGED}`);
      }),
    );

    server.registerTool(
      'update_signature',
      {
        title: 'Update a signature',
        description:
          'Change a signature: group, type, name, description, or link it to a connection (short ids are fine).',
        inputSchema: z.object({
          map: MapArg,
          signature: z.string().min(4).max(64).describe('Signature id (short id from list_signatures)'),
          group: SignatureGroup.optional(),
          type: z.string().max(64).nullable().optional(),
          name: z.string().max(128).nullable().optional(),
          description: z.string().max(2000).optional(),
          connection: z
            .string()
            .min(4)
            .max(64)
            .nullable()
            .optional()
            .describe('Connection id to link, or null to unlink'),
        }),
        annotations: write,
      },
      run(async ({ map, signature, group, type, name, description, connection }) => {
        const view = await loadMap(map, true);
        need({ resource: 'signatures', action: 'write' }, view.mapId);
        const all = view.signatures ?? (await allSignatures(deps, actor!, view));
        const target = byShortId(all, signature, 'signature');
        const linked =
          connection === undefined
            ? undefined
            : connection === null
              ? null
              : byShortId(view.connections, connection, 'connection').id;
        const request = {
          ...(group ? { group } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(linked !== undefined ? { connectionId: linked } : {}),
        };
        const sig = await deps.merged.route(
          view.mapId,
          (w) => w.updateSignature(actor, view.mapId, target.id, request),
          () => deps.signatures.update(actor, view.mapId, target.id, request),
        );
        return text(sig ? `Updated ${signatureLine(sig)}` : `Updated ${target.eveId} ${MERGED}`);
      }),
    );

    server.registerTool(
      'add_connection',
      {
        title: 'Add a connection',
        description:
          'Connect two systems on the map (they are added to the map when missing). Type defaults to gate when a stargate links them, else wormhole.',
        inputSchema: z.object({
          map: MapArg,
          from: SystemArg,
          to: SystemArg,
          type: z.enum(['wormhole', 'gate', 'bridge']).optional(),
        }),
        annotations: write,
      },
      run(async ({ map, from, to, type }) => {
        const view = await loadMap(map, true);
        need({ resource: 'connections', action: 'write' }, view.mapId);
        const source = resolveSystem(from);
        const target = resolveSystem(to);
        for (const id of [source, target]) {
          if (!view.systems.some((s) => s.solarSystemId === id)) {
            need({ resource: 'systems', action: 'write' }, view.mapId);
            await deps.merged.route(
              view.mapId,
              (w) => w.addSystem(actor, view.mapId, { solarSystemId: id }),
              () => deps.systems.add(actor, view.mapId, { solarSystemId: id }),
            );
          }
        }
        const request = { source, target, ...(type ? { type } : {}) };
        const c = await deps.merged.route(
          view.mapId,
          (w) => w.addConnection(actor, view.mapId, request),
          () => deps.connections.add(actor, view.mapId, request),
        );
        return text(
          c
            ? `Connected ${connectionLine(deps.universe, c, true)}`
            : `Connected ${systemName(deps.universe, source)} and ${systemName(deps.universe, target)} ${MERGED}`,
        );
      }),
    );

    server.registerTool(
      'update_connection',
      {
        title: 'Update a connection',
        description: 'Set mass, time (EOL), size, mass saved, danger or bubbles of a connection.',
        inputSchema: z.object({
          map: MapArg,
          connection: z.string().min(4).max(64).describe('Connection id (short id from get_map)'),
          massStatus: z.enum(['fresh', 'reduced', 'critical']).optional(),
          timeStatus: z.enum(['normal', 'eol']).optional(),
          shipSize: z.enum(['small', 'medium', 'large', 'xlarge']).optional(),
          massSaved: z.boolean().optional(),
          dangerous: z.boolean().optional(),
          bubbled: z.enum(['none', 'source', 'target', 'both']).optional(),
        }),
        annotations: write,
      },
      run(async ({ map, connection, ...patch }) => {
        const view = await loadMap(map, true);
        need({ resource: 'connections', action: 'write' }, view.mapId);
        const target = byShortId(view.connections, connection, 'connection');
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        if (Object.keys(defined).length === 0) throw new ValidationError('Nothing to change');
        const c = await deps.merged.route(
          view.mapId,
          (w) => w.updateConnection(actor, view.mapId, target.id, defined),
          () => deps.connections.update(actor, view.mapId, target.id, defined),
        );
        return text(`Updated ${connectionLine(deps.universe, c ?? { ...target, ...defined }, true)}`);
      }),
    );

    server.registerTool(
      'add_note',
      {
        title: 'Add a note to a system',
        description: 'Append a line to the notes of a system on the map (or replace them).',
        inputSchema: z.object({
          map: MapArg,
          system: SystemArg,
          note: z.string().min(1).max(2000),
          replace: z.boolean().optional().describe('Replace the notes instead of appending'),
        }),
        annotations: write,
      },
      run(async ({ map, system, note, replace }) => {
        const view = await loadMap(map, true);
        need({ resource: 'systems', action: 'write' }, view.mapId);
        const id = resolveSystem(system);
        const current = view.systems.find((s) => s.solarSystemId === id);
        if (!current) throw new NotFoundError('System on this map');
        const description = replace || !current.description ? note : `${current.description}\n${note}`;
        if (description.length > 10_000)
          throw new ValidationError('The notes would be longer than 10 000 characters');
        await deps.merged.route(
          view.mapId,
          (w) => w.updateSystem(actor, view.mapId, id, { description }),
          () => deps.systems.update(actor, view.mapId, id, { description }),
        );
        return text(`Notes of ${systemName(deps.universe, id)} now: "${oneLine(description, 200)}"`);
      }),
    );
  }

  // ---- resources and prompts -------------------------------------------------------------

  server.registerResource(
    'map-snapshot',
    new ResourceTemplate('darkbeacon://maps/{map}/snapshot', {
      list: async () => {
        if (anonymous) {
          const shared = deps.publishing ? await deps.publishing.publicForAgents() : [];
          return {
            resources: shared.map((a) => ({
              uri: `darkbeacon://maps/${a.share.slug ?? a.share.token}/snapshot`,
              name: `Public map ${a.share.slug ?? 'snapshot'}`,
              mimeType: 'application/json',
            })),
          };
        }
        if (!may({ resource: 'maps', action: 'read' }, null)) return { resources: [] };
        const maps = await deps.maps.list(actor);
        return {
          resources: maps.map((m) => ({
            uri: `darkbeacon://maps/${m.id}/snapshot`,
            name: m.name,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Map snapshot',
      description: 'The map as JSON: systems, connections, exits (and what else the caller may see).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const ref = String(variables.map);
      const view = await loadMap(ref);
      const compact = {
        map: { name: view.name, ref: view.ref },
        systems: view.systems.map((s) => ({
          id: s.solarSystemId,
          name: systemName(deps.universe, s.solarSystemId, s),
          class: securityLabel(deps.universe.getSystem(s.solarSystemId)),
          status: s.status,
          tag: s.tag,
          notes: s.description || undefined,
        })),
        connections: view.connections.map((c) => ({
          id: short(c.id),
          from: c.source,
          to: c.target,
          type: c.type,
          ...(view.connectionStatus ? { mass: c.massStatus, time: c.timeStatus, size: c.shipSize } : {}),
        })),
        exits: view.exits.map((e) => ({
          system: e.name,
          kind: e.kind,
          nearest: e.nearest ? `${e.nearest.name} ${e.nearest.jumps}j` : null,
        })),
        ...(view.signatures
          ? {
              signatures: view.signatures.map((s) => ({
                system: s.solarSystemId,
                id: s.eveId,
                group: s.group,
                type: s.type,
              })),
            }
          : {}),
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(compact) }] };
    },
  );

  server.registerPrompt(
    'summarise_chain',
    {
      title: 'Summarise the chain',
      description: 'Ask for a short briefing on a chain: how to get out, what is dying, what is dangerous.',
      argsSchema: z.object({ map: MapArg }),
    },
    ({ map }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use get_map and list_connections for map ${map}. Brief me in under 150 words: the shortest way out to a trade hub, connections that are EOL or critical, anything marked dangerous or hostile, and what is unscanned.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'plan_route_home',
    {
      title: 'Plan the route home',
      description: 'Plan a route from a system back to the home system of the chain.',
      argsSchema: z.object({ map: MapArg, from: SystemArg }),
    },
    ({ map, from }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `On map ${map}, find the system with status home (get_map), then use find_route from ${from} to it with mode safer, and again with skip eol,critical. Say which route you recommend and why, in a few lines.`,
          },
        },
      ],
    }),
  );

  return server;
}

/** Signatures of every system the view has, when the snapshot did not carry them. */
async function allSignatures(deps: McpDeps, actor: Actor, view: MapView): Promise<SignatureDto[]> {
  const all: SignatureDto[] = [];
  for (const s of view.systems) all.push(...(await deps.signatures.list(actor, view.mapId, s.solarSystemId)));
  return all;
}

/** The caller of a request, from the actor the guard resolved (API keys only; no cookies). */
export function callerFor(actor: Actor | null): McpCaller {
  const grant = grantOf(actor);
  return actor && grant ? { kind: 'key', actor, grant } : { kind: 'anonymous' };
}
