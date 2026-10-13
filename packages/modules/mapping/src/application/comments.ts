import { ConflictError, NotFoundError, newId, type Actor } from '@darkbeacon/core';
import { COMMENT_MAX_LENGTH, type AddCommentRequest } from '@darkbeacon/shared';
import type { Comment } from '../domain/map.js';
import type { CommentRepository } from '../ports/index.js';
import { MappingUseCases, type MappingPorts } from './base.js';

/** Most comments one system keeps; remove some to add more. */
export const MAX_COMMENTS_PER_SYSTEM = 500;

export interface CommentPorts extends MappingPorts {
  comments: CommentRepository;
}

/**
 * Comment threads on the systems of a map. Viewers read them; members write and remove them
 * (anyone's, as in Wanderer: a thread is the map's, not its author's). A hidden system keeps its
 * comments. Maps that merge others have no comments of their own.
 */
export class CommentUseCases extends MappingUseCases {
  constructor(protected override readonly ports: CommentPorts) {
    super(ports);
  }

  async list(actor: Actor | null, mapId: string, solarSystemId: number): Promise<Comment[]> {
    await this.authorize(actor, mapId, 'viewer');
    if (await this.ports.overlay?.view(mapId)) return [];
    await this.visibleSystem(mapId, solarSystemId);
    return this.ports.comments.listForSystem(mapId, solarSystemId);
  }

  /** How many comments each visible system has. */
  async counts(actor: Actor | null, mapId: string): Promise<Map<number, number>> {
    await this.authorize(actor, mapId, 'viewer');
    return this.ports.comments.countsForMap(mapId);
  }

  async add(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: AddCommentRequest,
  ): Promise<Comment> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = (await this.ports.authors?.author(who)) ?? null;
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const thread = await this.ports.comments.listForSystem(mapId, solarSystemId);
      if (thread.length >= MAX_COMMENTS_PER_SYSTEM)
        throw new ConflictError('This system has too many comments; remove some first');
      const comment: Comment = {
        id: newId(),
        mapId,
        solarSystemId,
        text: request.text.trim(),
        author,
        createdAt: this.ports.clock.now(),
      };
      await this.ports.comments.insert(comment);
      events.add('comment.added', comment);
      return comment;
    });
  }

  async remove(actor: Actor | null, mapId: string, commentId: string): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const comment = await this.ports.comments.findById(mapId, commentId);
      if (!comment) throw new NotFoundError('Comment');
      await this.visibleSystem(mapId, comment.solarSystemId).catch(() => {
        throw new NotFoundError('Comment');
      });
      await this.ports.comments.delete(mapId, commentId);
      events.add('comment.removed', { id: comment.id, solarSystemId: comment.solarSystemId }, comment);
    });
  }

  /**
   * A comment from another mapper (an import): written as its author wrote it and when. With
   * `existingId` (what an earlier import wrote) still there, nothing changes; comments are not
   * edited, and one removed here comes back only if the import runs again.
   */
  async importComment(
    actor: Actor | null,
    mapId: string,
    comment: Pick<Comment, 'solarSystemId' | 'text' | 'author'> & { createdAt: number | null },
    existingId: string | null,
  ): Promise<{ comment: Comment; outcome: 'created' | 'unchanged' }> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const existing = existingId ? await this.ports.comments.findById(mapId, existingId) : null;
      if (existing) return { comment: existing, outcome: 'unchanged' as const };
      // Hidden systems keep their comments: they are intel for when the system shows up again.
      await this.knownSystem(mapId, comment.solarSystemId);
      const created: Comment = {
        id: newId(),
        mapId,
        solarSystemId: comment.solarSystemId,
        text: comment.text.trim().slice(0, COMMENT_MAX_LENGTH),
        author: comment.author,
        createdAt: comment.createdAt ?? this.ports.clock.now(),
      };
      await this.ports.comments.insert(created);
      events.add('comment.added', created);
      return { comment: created, outcome: 'created' as const };
    });
  }

  /** Puts a removed comment back as it was (the revert of a removal). */
  async restore(actor: Actor | null, mapId: string, comment: Comment): Promise<Comment> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, comment.solarSystemId);
      if (await this.ports.comments.findById(mapId, comment.id))
        throw new ConflictError('The comment is already back');
      const restored: Comment = { ...comment, mapId };
      await this.ports.comments.insert(restored);
      events.add('comment.added', restored);
      return restored;
    });
  }
}
