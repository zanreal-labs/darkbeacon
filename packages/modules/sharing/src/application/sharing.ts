import {
  ConflictError,
  ForbiddenError,
  actorRef,
  mapStream,
  newEvent,
  requireMapRole,
  type Actor,
  type Clock,
  type DomainEvent,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import type {
  LabelDto,
  MapSharingDto,
  McpMode,
  PublicMapDto,
  PublicSnapshotDto,
  ShareScope,
  UpdateMapSharingRequest,
} from '@darkbeacon/shared';
import { projectEvent, projectLabels, projectSnapshot } from '../domain/projection.js';
import {
  SHARE_TOKEN_LENGTH,
  defaultShare,
  effectiveMcpMode,
  looksLikeToken,
  normalizeScopes,
  type MapShare,
} from '../domain/share.js';
import type { MapShareRepository, MapSnapshotReader, ShareSecrets, SharingPolicy } from '../ports/index.js';

export interface MapSharingDeps {
  shares: MapShareRepository;
  access: MapAccess;
  policy: SharingPolicy;
  secrets: ShareSecrets;
  snapshots: MapSnapshotReader;
  uow: UnitOfWork;
  events: EventLog;
  clock: Clock;
  /** Public origin, for the link shown to admins. */
  publicUrl: string;
}

/** A resolved public link: the share, and the actor its visitors act as. */
export interface PublicAccess {
  share: MapShare;
  actor: Extract<Actor, { kind: 'public' }>;
  scopes: ReadonlySet<ShareScope>;
}

export interface PublicView {
  map: PublicMapDto;
  seq: number;
  snapshot: PublicSnapshotDto;
}

/**
 * Public maps. Map admins switch a map's link on and choose what it shows; anonymous visitors
 * read it through the same use cases as everyone else, as a `public` actor that is a viewer of
 * that one map, and every answer goes through the projection, so what a scope does not share
 * never leaves the server.
 */
export class MapSharing {
  constructor(private readonly deps: MapSharingDeps) {}

  async get(actor: Actor | null, mapId: string): Promise<MapSharingDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return this.toDto((await this.deps.shares.find(mapId)) ?? defaultShare(mapId));
  }

  async update(actor: Actor | null, mapId: string, request: UpdateMapSharingRequest): Promise<MapSharingDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    if (request.enabled && !(await this.deps.policy.publicMaps())) {
      throw new ForbiddenError('Public maps are switched off on this instance');
    }
    return this.deps.uow.transaction(async () => {
      const current = (await this.deps.shares.find(mapId)) ?? defaultShare(mapId);
      const next: MapShare = {
        ...current,
        enabled: request.enabled ?? current.enabled,
        slug: request.slug === undefined ? current.slug : request.slug,
        scopes: request.scopes ? normalizeScopes(request.scopes) : current.scopes,
        noindex: request.noindex ?? current.noindex,
        mcpMode: request.mcpMode ?? current.mcpMode,
      };
      if (next.enabled && !next.token) next.token = this.deps.secrets.random(SHARE_TOKEN_LENGTH);
      if (next.slug && next.slug !== current.slug) {
        const taken = await this.deps.shares.findBySlug(next.slug);
        if (taken && taken.mapId !== mapId) throw new ConflictError('That public name is taken');
      }
      return this.save(actor!, current, next, false);
    });
  }

  /** A new link; the old one stops working at once (open public pages lose their stream). */
  async regenerate(actor: Actor | null, mapId: string): Promise<MapSharingDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return this.deps.uow.transaction(async () => {
      const current = (await this.deps.shares.find(mapId)) ?? defaultShare(mapId);
      const next = { ...current, token: this.deps.secrets.random(SHARE_TOKEN_LENGTH) };
      return this.save(actor!, current, next, true);
    });
  }

  /** The map is gone: so is its link. */
  async forgetMap(mapId: string): Promise<void> {
    await this.deps.shares.delete(mapId);
  }

  /** The public link `id` (a token or a slug) when it is on; null otherwise (unknown, off, not allowed). */
  async resolve(id: string): Promise<PublicAccess | null> {
    if (!(await this.deps.policy.publicMaps())) return null;
    const share = looksLikeToken(id)
      ? await this.deps.shares.findByToken(id)
      : await this.deps.shares.findBySlug(id);
    if (!share?.enabled || !share.token) return null;
    // A slug only works while it still names the share (it may have been changed since).
    if (!looksLikeToken(id) && share.slug !== id) return null;
    return {
      share,
      actor: { kind: 'public', id: share.mapId, mapId: share.mapId },
      scopes: new Set(share.scopes),
    };
  }

  /** What the public page shows, read as the public actor and cut down by the projection. */
  async view(access: PublicAccess): Promise<PublicView> {
    const { seq, data } = await this.deps.snapshots.read(access.actor, access.share.mapId);
    const map = data.map as { id: string; name: string; labels: LabelDto[] } | undefined;
    return {
      map: {
        id: access.share.mapId,
        name: map?.name ?? 'Map',
        labels: projectLabels(map?.labels ?? [], access.scopes),
        scopes: access.share.scopes,
        noindex: access.share.noindex,
      },
      seq,
      snapshot: projectSnapshot(data, access.scopes),
    };
  }

  /** A map event as the visitors of a public stream receive it (null: not for them). */
  project(access: PublicAccess, event: DomainEvent, stream: string): DomainEvent | null {
    return projectEvent(event, access.scopes, stream);
  }

  /** Maps anonymous AI agents may read: public, and opened to agents by the instance and the map. */
  async publicForAgents(): Promise<PublicAccess[]> {
    if ((await this.deps.policy.mcpMode()) !== 'public' || !(await this.deps.policy.publicMaps())) return [];
    return (await this.deps.shares.listEnabled())
      .filter((s) => s.mcpMode === 'public' && s.token)
      .map((share) => ({
        share,
        actor: { kind: 'public' as const, id: share.mapId, mapId: share.mapId },
        scopes: new Set(share.scopes),
      }));
  }

  /** How far AI agents reach a map: the lower of the instance mode and the map's own setting. */
  async mcpModeFor(mapId: string): Promise<McpMode> {
    const instance = await this.deps.policy.mcpMode();
    const share = (await this.deps.shares.find(mapId)) ?? defaultShare(mapId);
    const map = effectiveMcpMode(instance, share.mcpMode);
    // Anonymous reach needs the public link to be on.
    return map === 'public' && !(share.enabled && (await this.deps.policy.publicMaps()))
      ? 'authenticated'
      : map;
  }

  private async save(
    actor: Actor,
    before: MapShare,
    next: MapShare,
    regenerated: boolean,
  ): Promise<MapSharingDto> {
    const changed =
      regenerated ||
      JSON.stringify({ ...before, updatedAt: 0, updatedBy: null }) !==
        JSON.stringify({ ...next, updatedAt: 0, updatedBy: null });
    if (!changed) return this.toDto(before);
    const saved: MapShare = {
      ...next,
      updatedAt: this.deps.clock.now(),
      updatedBy: actor.kind === 'account' ? actor.id : null,
    };
    await this.deps.shares.save(saved);
    const view = (s: MapShare) => ({
      mapId: s.mapId,
      enabled: s.enabled,
      slug: s.slug,
      scopes: s.scopes,
      noindex: s.noindex,
      mcpMode: s.mcpMode,
      regenerated: false,
    });
    await this.deps.events.append([
      newEvent({
        stream: mapStream(saved.mapId),
        type: 'access.sharing_changed',
        actor: actorRef(actor),
        data: { ...view(saved), regenerated },
        before: view(before),
        occurredAt: this.deps.clock.now(),
      }),
    ]);
    return this.toDto(saved);
  }

  private toDto(share: MapShare): MapSharingDto {
    return {
      mapId: share.mapId,
      enabled: share.enabled,
      token: share.token,
      slug: share.slug,
      url: share.enabled && share.token ? `${this.deps.publicUrl}/p/${share.token}` : null,
      scopes: share.scopes,
      noindex: share.noindex,
      mcpMode: share.mcpMode,
      updatedAt: share.updatedAt,
    };
  }
}
