import { sameValue, type ChangeReverter, type StoredEvent } from '@darkbeacon/audit';
import { ConflictError, type Actor } from '@darkbeacon/core';
import type {
  BookmarkNumberUseCases,
  ConnectionUseCases,
  MappingPorts,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
} from '@darkbeacon/mapping';
import type {
  ConnectionDto,
  LabelDto,
  MapDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
  UpdateConnectionRequest,
  UpdateSignatureRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';

const SYSTEM_FIELDS = [
  'position',
  'customName',
  'temporaryName',
  'tag',
  'status',
  'description',
  'labelIds',
  'systemLabelIds',
  'customLabel',
  'locked',
] as const satisfies ReadonlyArray<keyof UpdateSystemRequest>;
const CONNECTION_FIELDS = [
  'type',
  'timeStatus',
  'massStatus',
  'shipSize',
  'massSaved',
  'dangerous',
  'bubbled',
] as const satisfies ReadonlyArray<keyof UpdateConnectionRequest>;
const SIGNATURE_FIELDS = [
  'eveId',
  'group',
  'type',
  'name',
  'description',
  'connectionId',
] as const satisfies ReadonlyArray<keyof UpdateSignatureRequest>;

const CHANGED_SINCE = 'It changed again since; revert the later change first';

export interface MappingUseCaseSet {
  maps: MapUseCases;
  systems: SystemUseCases;
  connections: ConnectionUseCases;
  signatures: SignatureUseCases;
  /** Reverts of a wormhole's bookmark number; without it they are refused. */
  numbers?: BookmarkNumberUseCases;
}

/**
 * Reverts of map changes through the mapping use cases (so they are authorized and recorded
 * like any change). A revert is refused when the thing no longer looks as the change left it,
 * so it never overwrites somebody's later change.
 */
export class MappingReverter implements ChangeReverter {
  readonly types = [
    'system.added',
    'system.updated',
    'system.removed',
    'connection.added',
    'connection.updated',
    'connection.removed',
    'signature.added',
    'signature.updated',
    'signature.removed',
    'labels.changed',
    'system_labels.changed',
    'map.settings_changed',
  ] as const;

  constructor(
    private readonly ports: Pick<MappingPorts, 'maps' | 'systems' | 'connections' | 'signatures'>,
    private readonly uc: MappingUseCaseSet,
  ) {}

  async revert(actor: Actor, mapId: string, { event, audit }: StoredEvent): Promise<void> {
    const diff = audit?.diff ?? {};
    const removed = audit?.removed ?? null;
    switch (event.type) {
      case 'system.added': {
        const { solarSystemId } = event.data as MapSystemDto;
        const current = await this.ports.systems.find(mapId, solarSystemId);
        if (!current?.visible) throw new ConflictError('The system is already gone');
        if (current.locked) throw new ConflictError('The system is locked');
        await this.uc.systems.remove(actor, mapId, solarSystemId);
        return;
      }
      case 'system.updated': {
        const { solarSystemId } = event.data as MapSystemDto;
        const current = await this.ports.systems.find(mapId, solarSystemId);
        if (!current?.visible) throw new ConflictError('The system is gone');
        const patch = this.backPatch(diff, current, SYSTEM_FIELDS);
        await this.uc.systems.update(actor, mapId, solarSystemId, patch);
        return;
      }
      case 'system.removed': {
        const before = removed as Partial<MapSystemDto> | null;
        const { solarSystemId } = event.data as { solarSystemId: number };
        const current = await this.ports.systems.find(mapId, solarSystemId);
        if (current?.visible) throw new ConflictError('The system is already back');
        await this.uc.systems.add(actor, mapId, {
          solarSystemId,
          ...(before?.position ? { position: before.position } : {}),
        });
        return;
      }
      case 'connection.added': {
        const { id } = event.data as ConnectionDto;
        if (!(await this.ports.connections.findById(mapId, id)))
          throw new ConflictError('The connection is already gone');
        await this.uc.connections.remove(actor, mapId, id);
        return;
      }
      case 'connection.updated': {
        const { id } = event.data as ConnectionDto;
        const current = await this.ports.connections.findById(mapId, id);
        if (!current) throw new ConflictError('The connection is gone');
        const number = diff.bookmarkNumber;
        if (number && !CONNECTION_FIELDS.some((f) => diff[f]) && this.uc.numbers) {
          // A number given by hand or by renumbering: back to the number it had, if it can be.
          if (!sameValue(current.bookmarkNumber ?? null, number.after))
            throw new ConflictError(CHANGED_SINCE);
          if (typeof number.before !== 'number') throw new ConflictError('It had no number before');
          if (diff.bookmarkParent) throw new ConflictError('It is reached from another system now');
          await this.uc.numbers.setNumber(actor, mapId, id, number.before);
          return;
        }
        await this.uc.connections.update(actor, mapId, id, this.backPatch(diff, current, CONNECTION_FIELDS));
        return;
      }
      case 'connection.removed': {
        const before = removed as Partial<ConnectionDto> | null;
        if (!before?.source || !before.target)
          throw new ConflictError('Nothing is known about that connection');
        if (await this.ports.connections.findBetween(mapId, before.source, before.target))
          throw new ConflictError('Those systems are connected again');
        const added = await this.uc.connections.add(actor, mapId, {
          source: before.source,
          target: before.target,
          ...(before.type ? { type: before.type } : {}),
        });
        const restore = pick(before, CONNECTION_FIELDS);
        await this.uc.connections.update(actor, mapId, added.id, restore);
        return;
      }
      case 'signature.added': {
        const { id } = event.data as SignatureDto;
        if (!(await this.ports.signatures.findById(mapId, id)))
          throw new ConflictError('The signature is already gone');
        await this.uc.signatures.remove(actor, mapId, id);
        return;
      }
      case 'signature.updated': {
        const { id } = event.data as SignatureDto;
        const current = await this.ports.signatures.findById(mapId, id);
        if (!current) throw new ConflictError('The signature is gone');
        await this.uc.signatures.update(actor, mapId, id, this.backPatch(diff, current, SIGNATURE_FIELDS));
        return;
      }
      case 'signature.removed': {
        const before = removed as Partial<SignatureDto> | null;
        if (!before?.eveId || !before.solarSystemId)
          throw new ConflictError('Nothing is known about that signature');
        const siblings = await this.ports.signatures.listForSystem(mapId, before.solarSystemId);
        if (siblings.some((s) => s.eveId === before.eveId))
          throw new ConflictError(`Signature ${before.eveId} is there again`);
        const added = await this.uc.signatures.add(actor, mapId, before.solarSystemId, {
          eveId: before.eveId,
          ...(before.group ? { group: before.group } : {}),
          type: before.type ?? null,
          name: before.name ?? null,
          description: before.description ?? '',
        });
        if (before.connectionId && (await this.ports.connections.findById(mapId, before.connectionId)))
          await this.uc.signatures.update(actor, mapId, added.id, { connectionId: before.connectionId });
        return;
      }
      case 'labels.changed': {
        const current = await this.ports.maps.findById(mapId);
        const change = diff.labels;
        if (!current || !change) throw new ConflictError('Nothing to revert');
        if (!sameValue(current.labels, change.after)) throw new ConflictError(CHANGED_SINCE);
        await this.uc.maps.setLabels(actor, mapId, (change.before ?? []) as LabelDto[]);
        return;
      }
      case 'system_labels.changed': {
        const current = await this.ports.maps.findById(mapId);
        const change = diff.systemLabels;
        if (!current || !change) throw new ConflictError('Nothing to revert');
        if (!sameValue(current.systemLabels, change.after)) throw new ConflictError(CHANGED_SINCE);
        await this.uc.maps.setSystemLabels(actor, mapId, (change.before ?? []) as SystemLabelDto[]);
        return;
      }
      case 'map.settings_changed': {
        const current = await this.ports.maps.findById(mapId);
        if (!current) throw new ConflictError('The map is gone');
        const patch = this.backPatch(
          diff,
          current as unknown as MapDto,
          ['name', 'slug', 'settings'] as const,
        );
        await this.uc.maps.update(actor, mapId, patch as Parameters<MapUseCases['update']>[2]);
        return;
      }
      default:
        throw new ConflictError('This change cannot be reverted');
    }
  }

  /**
   * The fields the change touched, set back to their before values; refused when any of them
   * no longer has the value the change gave it.
   */
  private backPatch<T extends object, K extends keyof T & string>(
    diff: Record<string, { before: unknown; after: unknown }>,
    current: T,
    fields: readonly K[],
  ): Partial<Pick<T, K>> {
    const patch: Partial<Pick<T, K>> = {};
    for (const field of fields) {
      const change = diff[field];
      if (!change) continue;
      if (!sameValue(current[field], change.after)) throw new ConflictError(CHANGED_SINCE);
      patch[field] = change.before as T[K];
    }
    if (Object.keys(patch).length === 0) throw new ConflictError('Nothing to revert');
    return patch;
  }
}

function pick<T extends object, K extends keyof T>(
  value: Partial<T>,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  return out;
}
