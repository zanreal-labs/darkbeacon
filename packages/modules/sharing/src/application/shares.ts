import {
  hasMapRole,
  mapStream,
  newEvent,
  actorRef,
  newId,
  NotFoundError,
  requireAccount,
  requireMapRole,
  type Actor,
  type NewEvent,
} from '@darkbeacon/core';
import {
  DEFAULT_SHARE_SCOPES,
  LOCAL_INSTANCE,
  type AcceptShareRequest,
  type ChainOrigin,
  type MapShareDto,
  type MapSharesDto,
  type OfferShareRequest,
  type UpdateShareRequest,
} from '@darkbeacon/shared';
import { sameOrigin } from '../domain/keys.js';
import {
  acceptShare,
  checkOffer,
  checkRevoke,
  offerShare,
  shareDto,
  updateShare,
  type Share,
  type Sides,
} from '../domain/shares.js';
import type { ChainMerger } from './merger.js';
import type { SharingPorts } from './ports.js';

type ShareEvent = 'map.share.offered' | 'map.share.accepted' | 'map.share.changed' | 'map.share.revoked';

const local = (mapId: string): ChainOrigin => ({ instance: LOCAL_INSTANCE, mapId });

/**
 * Shares between maps (the grants): a source map's admins offer it to another map with a level
 * and scopes, the target's admins accept (one step when the same person administers both), either
 * side revokes. Every change is an event on both maps' streams; merged views follow at once.
 */
export class SharingUseCases {
  constructor(
    private readonly ports: SharingPorts,
    private readonly merger: ChainMerger,
  ) {}

  /** What the map gives and gets (its admins). */
  async list(actor: Actor | null, mapId: string): Promise<MapSharesDto> {
    await requireMapRole(this.ports.access, actor, mapId, 'admin');
    const shares = await this.ports.shares.listForMap(local(mapId));
    const out: MapSharesDto = { outgoing: [], incoming: [] };
    for (const share of shares.sort((a, b) => a.offeredAt - b.offeredAt)) {
      const dto = await this.toDto(share);
      if (sameOrigin(share.source, local(mapId))) out.outgoing.push(dto);
      if (sameOrigin(share.target, local(mapId))) out.incoming.push(dto);
    }
    return out;
  }

  /** The map's admin offers it to another map, found by id (one the admin can see) or address. */
  async offer(actor: Actor | null, mapId: string, request: OfferShareRequest): Promise<MapShareDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'admin');
    const source = await this.ports.sources.describe(local(mapId));
    if (!source) throw new NotFoundError('Map');
    const target = request.targetSlug
      ? await this.ports.sources.findLocalBySlug(request.targetSlug)
      : await this.ports.sources.describe(local(request.targetMapId!));
    if (!target) throw new NotFoundError('Target map');
    const existing = await this.ports.shares.listForMap(local(mapId));
    checkOffer({ ...source.origin, kind: source.kind }, target.origin, existing);
    const sides: Sides = { sourceAdmin: true, targetAdmin: await this.isAdmin(account, target.origin) };
    const share = offerShare({
      id: newId(),
      source: source.origin,
      target: target.origin,
      level: request.level,
      scopes: request.scopes ?? DEFAULT_SHARE_SCOPES,
      by: account.id,
      sides,
      now: this.ports.clock.now(),
    });
    const dto = await this.toDto(share);
    await this.ports.uow.transaction(async () => {
      await this.ports.shares.insert(share);
      const events = this.events(account, 'map.share.offered', share, dto);
      if (share.status === 'active') events.push(...this.events(account, 'map.share.accepted', share, dto));
      await this.ports.events.append(events);
    });
    if (share.status === 'active') await this.merger.rebuild(share.target.mapId);
    return dto;
  }

  /** The target's admin accepts an offer, optionally keeping only some of the scopes. */
  async accept(
    actor: Actor | null,
    mapId: string,
    shareId: string,
    request: AcceptShareRequest,
  ): Promise<MapShareDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'admin');
    const current = await this.load(mapId, shareId);
    const next = acceptShare(current, {
      by: account.id,
      sides: await this.sides(account, current),
      ...(request.scopes ? { scopes: request.scopes } : {}),
      now: this.ports.clock.now(),
    });
    const dto = await this.toDto(next);
    await this.ports.uow.transaction(async () => {
      await this.ports.shares.update(next);
      await this.ports.events.append(
        this.events(account, 'map.share.accepted', next, dto, await this.toDto(current)),
      );
    });
    await this.merger.rebuild(next.target.mapId);
    return dto;
  }

  /** Level and offered scopes (source admins); narrowed scopes and hidden (target admins). */
  async update(
    actor: Actor | null,
    mapId: string,
    shareId: string,
    request: UpdateShareRequest,
  ): Promise<MapShareDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'admin');
    const current = await this.load(mapId, shareId);
    const next = updateShare(current, request, await this.sides(account, current), this.ports.clock.now());
    if (!next) return this.toDto(current);
    const dto = await this.toDto(next);
    await this.ports.uow.transaction(async () => {
      // One default for new objects per composite: the others give it up.
      if (next.defaultWrite && !current.defaultWrite) {
        for (const other of await this.ports.shares.listActiveForTarget(next.target)) {
          if (other.id === next.id || !other.defaultWrite) continue;
          const plain = { ...other, defaultWrite: false, updatedAt: next.updatedAt };
          await this.ports.shares.update(plain);
          await this.ports.events.append(
            this.events(
              account,
              'map.share.changed',
              plain,
              await this.toDto(plain),
              await this.toDto(other),
            ),
          );
        }
      }
      await this.ports.shares.update(next);
      await this.ports.events.append(
        this.events(account, 'map.share.changed', next, dto, await this.toDto(current)),
      );
    });
    if (next.status === 'active') await this.merger.rebuild(next.target.mapId);
    return dto;
  }

  /** Ends a share or declines an offer (either side's admins). The target stops showing it at once. */
  async revoke(actor: Actor | null, mapId: string, shareId: string): Promise<void> {
    const account = requireAccount(actor);
    await requireMapRole(this.ports.access, account, mapId, 'admin');
    const current = await this.load(mapId, shareId);
    checkRevoke(await this.sides(account, current));
    const dto = await this.toDto(current);
    await this.ports.uow.transaction(async () => {
      await this.ports.shares.delete(current.id);
      await this.ports.events.append(this.events(account, 'map.share.revoked', current, dto, dto));
    });
    if (current.status === 'active') await this.merger.rebuild(current.target.mapId);
  }

  /** A share the map is part of. Others read as not found. */
  private async load(mapId: string, shareId: string): Promise<Share> {
    const share = await this.ports.shares.findById(shareId);
    if (!share || (!sameOrigin(share.source, local(mapId)) && !sameOrigin(share.target, local(mapId))))
      throw new NotFoundError('Share');
    return share;
  }

  private async isAdmin(actor: Actor, origin: ChainOrigin): Promise<boolean> {
    if (origin.instance !== LOCAL_INSTANCE) return false;
    return hasMapRole(await this.ports.access.roleOf(actor, origin.mapId), 'admin');
  }

  private async sides(actor: Actor, share: Share): Promise<Sides> {
    return {
      sourceAdmin: await this.isAdmin(actor, share.source),
      targetAdmin: await this.isAdmin(actor, share.target),
    };
  }

  private async toDto(share: Share): Promise<MapShareDto> {
    const [source, target] = await Promise.all([
      this.ports.sources.describe(share.source),
      this.ports.sources.describe(share.target),
    ]);
    return shareDto(share, {
      sourceName: source?.name ?? 'A map that is gone',
      targetName: target?.name ?? 'A map that is gone',
      sourceInstanceName: source?.instanceName ?? null,
    });
  }

  /** The same event on both maps' streams (local ones only). */
  private events(
    actor: Actor,
    type: ShareEvent,
    share: Share,
    dto: MapShareDto,
    before?: MapShareDto,
  ): NewEvent[] {
    const now = this.ports.clock.now();
    const streams = [share.source, share.target]
      .filter((o) => o.instance === LOCAL_INSTANCE)
      .map((o) => mapStream(o.mapId));
    return [...new Set(streams)].map((stream) =>
      newEvent({
        stream,
        type,
        actor: actorRef(actor),
        data: dto,
        occurredAt: now,
        ...(before ? { before } : {}),
      }),
    );
  }
}
