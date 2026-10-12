import { sameValue, type ChangeReverter, type StoredEvent } from '@darkbeacon/audit';
import { ConflictError, type Actor } from '@darkbeacon/core';
import type { CommentUseCases, Structure, StructureUseCases } from '@darkbeacon/mapping';
import type { CommentDto, StructureDto, UpdateStructureRequest } from '@darkbeacon/shared';

const STRUCTURE_FIELDS = ['name', 'owner', 'status', 'endsAt', 'notes'] as const satisfies ReadonlyArray<
  keyof UpdateStructureRequest
>;

const CHANGED_SINCE = 'It changed again since; revert the later change first';

/**
 * Reverts of comments and structures through their use cases: an added one is removed, a removed
 * one comes back as it was, a changed structure gets its fields back unless they changed since.
 */
export class IntelReverter implements ChangeReverter {
  readonly types = [
    'comment.added',
    'comment.removed',
    'structure.added',
    'structure.updated',
    'structure.removed',
  ] as const;

  constructor(
    private readonly comments: CommentUseCases,
    private readonly structures: StructureUseCases,
    private readonly find: (mapId: string, id: string) => Promise<Structure | null>,
  ) {}

  async revert(actor: Actor, mapId: string, { event, audit }: StoredEvent): Promise<void> {
    const removed = audit?.removed ?? null;
    switch (event.type) {
      case 'comment.added':
        await this.comments.remove(actor, mapId, (event.data as CommentDto).id);
        return;
      case 'comment.removed':
        if (!removed) throw new ConflictError('Nothing is known about that comment');
        // The audit snapshot leaves out bookkeeping (map, times).
        await this.comments.restore(actor, mapId, {
          author: null,
          createdAt: event.occurredAt,
          ...(removed as Partial<CommentDto>),
          mapId,
        } as CommentDto);
        return;
      case 'structure.added':
        await this.structures.remove(actor, mapId, (event.data as StructureDto).id);
        return;
      case 'structure.removed':
        if (!removed) throw new ConflictError('Nothing is known about that structure');
        await this.structures.restore(actor, mapId, {
          createdBy: null,
          updatedBy: null,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          ...(removed as Partial<StructureDto>),
          mapId,
        } as StructureDto);
        return;
      case 'structure.updated': {
        const { id } = event.data as StructureDto;
        const current = await this.find(mapId, id);
        if (!current) throw new ConflictError('The structure is gone');
        const patch: UpdateStructureRequest = {};
        for (const field of STRUCTURE_FIELDS) {
          const change = audit?.diff[field];
          if (!change) continue;
          if (!sameValue(current[field], change.after)) throw new ConflictError(CHANGED_SINCE);
          (patch as Record<string, unknown>)[field] = change.before;
        }
        if (Object.keys(patch).length === 0) throw new ConflictError('Nothing to revert');
        await this.structures.update(actor, mapId, id, patch);
        return;
      }
      default:
        throw new ConflictError('This change cannot be reverted');
    }
  }
}
