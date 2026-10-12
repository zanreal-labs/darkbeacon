import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { grantOf, isId, mapStream, type Actor, type EventLog } from '@darkbeacon/core';
import { AccountService, CharacterService, EveDirectoryService } from '@darkbeacon/identity';
import type { MapRepository, UniverseCatalog } from '@darkbeacon/mapping';
import {
  nestPath,
  routes,
  scopesAllow,
  type CharacterPresenceDto,
  type MapSnapshot,
  type MapScopeResource,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config.js';
import {
  ActorResolverRegistry,
  bearerToken,
  ClientIp,
  CurrentActor,
  sameOrigin,
} from '../../platform/actor.js';
import { APP_CONFIG, EVENT_LOG, UNIVERSE_CATALOG } from '../../platform/tokens.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';
import { SseStreams } from '../../realtime/sse.js';
import { MAP_REPOSITORY } from '../mapping/mapping.tokens.js';
import {
  ULID,
  WANDERER_EVENT_TYPES,
  WandererStreamState,
  ulidOf,
  wandererConnection,
  wandererEvent,
  wandererFrame,
  wandererSystem,
  wandererTime,
  wandererTrackedCharacter,
  wandererCharacter,
  wormholeTypeOf,
  type FormatContext,
  type WandererCharacterFacts,
} from './format.js';
import { newId } from '@darkbeacon/core';

type Query = Record<string, string | undefined>;

/** An error in Wanderer's shape: `{"error": "..."}` with its status. */
class WandererError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = { error: message },
  ) {
    super(message);
  }
}

const IDENTIFIER_REQUIRED =
  'Map identifier required. Provide `map_identifier` in the path or `map_id`/`slug` in query.';
const NOT_FOUND = { error: 'Not found', details: 'The requested resource could not be found' };
/** Wanderer keeps 10 minutes of events (at most 1000) for `last_event_id`; the log keeps more. */
const BACKFILL = 1000;

/**
 * Wanderer's legacy public map API on Darkbeacon data, so bots written for Wanderer keep working:
 * `/api/map/{systems,system,connections,characters,user_characters}` (`?map_id=` or `?slug=`),
 * `/api/maps/:map_identifier/{systems,connections,tracked-characters}` and the SSE stream
 * `/api/maps/:map_identifier/events/stream` with Wanderer's event names and envelope. Read-only.
 *
 * The Bearer token is a Darkbeacon API key (personal or service) that reaches the map with read
 * scopes: the map key of Wanderer maps to a key scoped `map:<id>:*:read` (see docs/api.md).
 */
@Controller()
export class WandererCompatController {
  private readonly publicOrigin: string;

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(SseStreams) private readonly sse: SseStreams,
    @Inject(MAP_REPOSITORY) private readonly maps: MapRepository,
    @Inject(UNIVERSE_CATALOG) private readonly universe: UniverseCatalog,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(EveDirectoryService) private readonly eve: EveDirectoryService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
  }

  // --- legacy query form (/api/map/*) -----------------------------------------------------------

  @Get(nestPath(routes.wandererCompat.systems.path))
  systems(@CurrentActor() actor: Actor | null, @Query() query: Query, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.systemsBody(actor, await this.fromQuery(query)));
  }

  @Get(nestPath(routes.wandererCompat.system.path))
  system(@CurrentActor() actor: Actor | null, @Query() query: Query, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => {
      const mapId = await this.fromQuery(query);
      if (query.id === undefined)
        throw new WandererError(400, 'Bad Request', { errors: { detail: 'Bad Request' } });
      const { snapshot, ctx } = await this.read(actor, mapId, 'systems');
      const found = (snapshot.systems ?? []).find((s) => String(s.solarSystemId) === query.id);
      if (!found) throw new WandererError(404, 'Not found', NOT_FOUND);
      return { data: wandererSystem(found, ctx) };
    });
  }

  @Get(nestPath(routes.wandererCompat.connections.path))
  connections(@CurrentActor() actor: Actor | null, @Query() query: Query, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.connectionsBody(actor, await this.fromQuery(query), query));
  }

  @Get(nestPath(routes.wandererCompat.characters.path))
  trackedCharacters(@CurrentActor() actor: Actor | null, @Query() query: Query, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.charactersBody(actor, await this.fromQuery(query)));
  }

  @Get(nestPath(routes.wandererCompat.userCharacters.path))
  userCharacters(@CurrentActor() actor: Actor | null, @Query() query: Query, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.userCharactersBody(actor, await this.fromQuery(query)));
  }

  // --- path form (/api/maps/:map_identifier/*) --------------------------------------------------

  @Get(nestPath(routes.wandererCompat.mapSystems.path))
  mapSystems(@CurrentActor() actor: Actor | null, @Param('mapId') id: string, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.systemsBody(actor, await this.fromPath(id)));
  }

  @Get(nestPath(routes.wandererCompat.mapConnections.path))
  mapConnections(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') id: string,
    @Query() query: Query,
    @Res() reply: FastifyReply,
  ) {
    return this.answer(reply, async () => this.connectionsBody(actor, await this.fromPath(id), query));
  }

  @Get(nestPath(routes.wandererCompat.mapTrackedCharacters.path))
  mapCharacters(@CurrentActor() actor: Actor | null, @Param('mapId') id: string, @Res() reply: FastifyReply) {
    return this.answer(reply, async () => this.charactersBody(actor, await this.fromPath(id)));
  }

  @Get(nestPath(routes.wandererCompat.eventsStream.path))
  async stream(
    @CurrentActor() actor: Actor | null,
    @ClientIp() ip: string | null,
    @Param('mapId') id: string,
    @Query() query: Query,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    let opened: { mapId: string; snapshot: MapSnapshot; ctx: FormatContext };
    try {
      const mapId = await this.fromPath(id);
      opened = { mapId, ...(await this.read(actor, mapId, '*')) };
    } catch (error) {
      await this.fail(reply, error);
      return;
    }
    const { mapId, snapshot, ctx } = opened;
    const wanted = eventFilter(query.events);
    const state = new WandererStreamState(snapshot);
    const stream = mapStream(mapId);

    // `last_event_id` (a ULID): the stored events after it, before going live.
    const head = await this.log.headSeq(stream);
    let backfill = '';
    if (query.last_event_id && ULID.test(query.last_event_id)) {
      const events = await this.log.readSince(stream, Math.max(0, head - BACKFILL), BACKFILL);
      for (const event of events) {
        const envelope = wandererEvent(event, ctx, state);
        if (envelope && envelope.id > query.last_event_id && wanted.has(envelope.type))
          backfill += wandererFrame(envelope);
      }
    }
    const connected = wandererFrame(
      { type: 'connected', id: ulidOf(newId()) },
      { map_id: mapId, server_time: wandererTime(Date.now()) },
    );
    this.sse.start({
      request,
      reply,
      stream,
      actor,
      ip,
      sinceSeq: head,
      resolveActor: () => this.resolve(request, ip),
      preamble: connected + backfill,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Cache-Control' },
      frame: (message) => {
        if (message.op !== 'event') return null;
        const envelope = wandererEvent(message.event, ctx, state);
        return envelope && wanted.has(envelope.type) ? wandererFrame(envelope) : null;
      },
    });
  }

  // --- bodies -----------------------------------------------------------------------------------

  private async systemsBody(actor: Actor | null, mapId: string) {
    const { snapshot, ctx } = await this.read(actor, mapId, 'systems');
    const signatures = snapshot.signatures ?? [];
    return {
      data: {
        systems: (snapshot.systems ?? []).filter((s) => s.visible).map((s) => wandererSystem(s, ctx)),
        connections: (snapshot.connections ?? []).map((c) =>
          wandererConnection(c, mapId, wormholeTypeOf(c, signatures)),
        ),
      },
    };
  }

  private async connectionsBody(actor: Actor | null, mapId: string, query: Query) {
    const { snapshot } = await this.read(actor, mapId, 'connections');
    const signatures = snapshot.signatures ?? [];
    const source = query.solar_system_source;
    const target = query.solar_system_target;
    for (const value of [source, target]) {
      if (value !== undefined && !/^\d+$/.test(value))
        throw new WandererError(400, `Invalid system id: ${value}`);
    }
    const connections = (snapshot.connections ?? []).filter(
      (c) =>
        (source === undefined || String(c.source) === source) &&
        (target === undefined || String(c.target) === target),
    );
    return { data: connections.map((c) => wandererConnection(c, mapId, wormholeTypeOf(c, signatures))) };
  }

  private async charactersBody(actor: Actor | null, mapId: string) {
    const { snapshot } = await this.read(actor, mapId, 'tracking');
    const present = snapshot.characters ?? [];
    const facts = await this.facts(present);
    return {
      data: present.map((c) => wandererTrackedCharacter(c, mapId, facts.get(c.characterId) ?? fallback(c))),
    };
  }

  /** Characters on the map grouped by person, with each person's main character. */
  private async userCharactersBody(actor: Actor | null, mapId: string) {
    const { snapshot } = await this.read(actor, mapId, 'tracking');
    const present = snapshot.characters ?? [];
    const facts = await this.facts(present);
    const accounts = await this.accounts.names(present.map((c) => c.accountId));
    const byAccount = new Map<string, CharacterPresenceDto[]>();
    for (const c of present) byAccount.set(c.accountId, [...(byAccount.get(c.accountId) ?? []), c]);
    return {
      data: [...byAccount].map(([accountId, list]) => {
        const main = accounts.get(accountId)?.mainCharacterId ?? null;
        return {
          characters: list.map((c) =>
            wandererCharacter(c.characterId, facts.get(c.characterId) ?? fallback(c)),
          ),
          main_character_eve_id:
            main !== null && list.some((c) => c.characterId === main) ? String(main) : null,
        };
      }),
    };
  }

  // --- plumbing ---------------------------------------------------------------------------------

  /**
   * The map's snapshot as the actor may read it, after the same checks as a WebSocket subscribe
   * (map role, and for a key its scopes on this map for the resource).
   */
  private async read(
    actor: Actor | null,
    mapId: string,
    resource: MapScopeResource | '*',
  ): Promise<{ snapshot: MapSnapshot; ctx: FormatContext }> {
    if (!actor) throw new WandererError(401, "Missing or invalid 'Bearer' token");
    const grant = grantOf(actor);
    const stream = mapStream(mapId);
    const allowed =
      (!grant || scopesAllow(grant.scopes, { resource, action: 'read' }, mapId)) &&
      (await this.hub.check(actor, stream)) === null;
    if (!allowed) throw new WandererError(401, 'Unauthorized (invalid token for map)');
    const { data } = await this.hub.readSnapshot(stream, actor);
    const snapshot = data as MapSnapshot;
    const labels = new Map((snapshot.map?.labels ?? []).map((l) => [l.id, l]));
    const ctx: FormatContext = {
      mapId,
      labels,
      systemName: (id) => this.universe.getSystem(id)?.name ?? null,
    };
    return { snapshot, ctx };
  }

  /** `?map_id=` (wins) or `?slug=`. */
  private async fromQuery(query: Query): Promise<string> {
    if (query.map_id) {
      if (!isId(query.map_id) || !(await this.live(query.map_id)))
        throw new WandererError(400, IDENTIFIER_REQUIRED);
      return query.map_id;
    }
    if (query.slug) {
      const map = await this.maps.findBySlug(query.slug);
      if (!map || map.deletedAt) throw new WandererError(404, `Map not found for slug: ${query.slug}`);
      return map.id;
    }
    throw new WandererError(400, IDENTIFIER_REQUIRED);
  }

  /** A map id or a slug. */
  private async fromPath(identifier: string): Promise<string> {
    if (isId(identifier) && (await this.live(identifier))) return identifier;
    const map = await this.maps.findBySlug(identifier);
    if (!map || map.deletedAt) throw new WandererError(404, `Map not found for identifier: ${identifier}`);
    return map.id;
  }

  private async live(mapId: string): Promise<boolean> {
    const map = await this.maps.findById(mapId);
    return !!map && !map.deletedAt;
  }

  /** Corporation and alliance (with tickers) of the characters, from identity and ESI names. */
  private async facts(
    present: readonly CharacterPresenceDto[],
  ): Promise<Map<number, WandererCharacterFacts>> {
    const linked = await this.characters.linked(present.map((c) => c.characterId));
    const groups = [
      ...new Set(linked.flatMap((c) => [c.corporationId, ...(c.allianceId ? [c.allianceId] : [])])),
    ];
    const entities = groups.length > 0 ? await this.eve.entities(groups).catch(() => []) : [];
    const ticker = new Map(entities.map((e) => [e.id, e.ticker]));
    return new Map(
      linked.map((c) => [
        c.id,
        {
          name: c.name,
          corporationId: c.corporationId,
          corporationTicker: ticker.get(c.corporationId) ?? null,
          allianceId: c.allianceId,
          allianceTicker: c.allianceId ? (ticker.get(c.allianceId) ?? null) : null,
        },
      ]),
    );
  }

  private resolve(request: FastifyRequest, ip: string | null): Promise<Actor | null> {
    const like = { headers: request.headers, ip, url: request.url };
    if (bearerToken(like)) return this.actors.resolve(like);
    return sameOrigin(request.headers, this.publicOrigin) ? this.actors.session(like) : Promise.resolve(null);
  }

  private async answer(reply: FastifyReply, work: () => Promise<unknown>): Promise<void> {
    try {
      const body = await work();
      await reply.header('content-type', 'application/json; charset=utf-8').send(JSON.stringify(body));
    } catch (error) {
      await this.fail(reply, error);
    }
  }

  private async fail(reply: FastifyReply, error: unknown): Promise<void> {
    if (!(error instanceof WandererError)) throw error;
    await reply
      .status(error.status)
      .header('content-type', 'application/json; charset=utf-8')
      .send(JSON.stringify(error.body));
  }
}

function fallback(c: CharacterPresenceDto): WandererCharacterFacts {
  return {
    name: c.name,
    corporationId: null,
    corporationTicker: null,
    allianceId: null,
    allianceTicker: null,
  };
}

/** Wanderer's `events=` filter: names it knows; missing, empty or `*` is all of them. */
function eventFilter(raw: string | undefined): Set<string> {
  const all = new Set<string>(WANDERER_EVENT_TYPES);
  if (!raw || raw.trim() === '' || raw.trim() === '*') return all;
  return new Set(
    raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => all.has(t)),
  );
}
