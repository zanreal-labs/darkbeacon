'use client';

import { useState } from 'react';
import { MessagesSquare, SendHorizontal, Trash2 } from 'lucide-react';
import { buildPath, COMMENT_MAX_LENGTH, routes, type CommentDto } from '@darkbeacon/shared';
import { Markdown } from '../../components/Markdown';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { relativeTime } from '../../lib/time';
import { CharacterAvatar, ConfirmDialog, IconButton, Kbd, Skeleton, useToast } from '../../ui';
import { SidebarSection } from './SidebarSection';
import { useSystemList } from './useSystemList';
import styles from './sidebar.module.css';
import own from './records.module.css';

const newestFirst = (a: CommentDto, b: CommentDto) => b.createdAt - a.createdAt || b.id.localeCompare(a.id);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The system's comment thread, newest first: Markdown, who wrote it and when. Members write
 * (Ctrl/⌘+Enter sends) and remove (after a confirmation); viewers read.
 */
export function CommentsSection({
  mapId,
  solarSystemId,
  can,
  collapsed,
  onToggle,
}: {
  mapId: string;
  solarSystemId: number;
  can: MapPermissions;
  collapsed: boolean;
  onToggle(id: string): void;
}) {
  const toast = useToast();
  const comments = useSystemList<CommentDto>({
    key: 'comments',
    path: buildPath(routes.comments.list.path, { mapId, solarSystemId }),
    mapId,
    solarSystemId,
    events: { upsert: ['comment.added'], remove: 'comment.removed' },
    order: newestFirst,
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<CommentDto | null>(null);
  const list = comments.data ?? [];

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api(buildPath(routes.comments.add.path, { mapId, solarSystemId }), {
        method: 'POST',
        json: { text },
      });
      setDraft('');
    } catch (error) {
      toast({
        title: 'Could not add the comment',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: CommentDto) => {
    try {
      await api(buildPath(routes.comments.remove.path, { mapId, commentId: comment.id }), {
        method: 'DELETE',
      });
    } catch (error) {
      toast({
        title: 'Could not remove the comment',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      });
    }
  };

  return (
    <SidebarSection
      id="comments"
      title="Comments"
      count={comments.data ? list.length : undefined}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {can.edit && (
        <div className={own.composer}>
          <textarea
            className={styles.notes}
            aria-label="New comment"
            rows={2}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Write a comment… (Markdown)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className={own.composerBar}>
            <span className={own.hint}>
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd> sends · {draft.length}/{COMMENT_MAX_LENGTH}
            </span>
            <IconButton
              size="sm"
              variant="primary"
              label="Send comment"
              icon={<SendHorizontal />}
              loading={busy}
              disabled={!draft.trim()}
              onClick={() => void send()}
            />
          </div>
        </div>
      )}
      {comments.isLoading ? (
        <Skeleton height={14} width="70%" />
      ) : list.length === 0 ? (
        <p className={styles.empty}>
          <MessagesSquare aria-hidden />
          No comments here yet.
        </p>
      ) : (
        <ul className={own.comments}>
          {list.map((c) => (
            <li key={c.id} className={own.comment}>
              <div className={own.commentHead}>
                {c.author?.characterId ? (
                  <CharacterAvatar id={c.author.characterId} name={c.author.name} size={18} decorative />
                ) : null}
                <span className={own.author}>{c.author?.name ?? 'Darkbeacon'}</span>
                <time
                  className={own.when}
                  dateTime={new Date(c.createdAt).toISOString()}
                  title={new Date(c.createdAt).toLocaleString()}
                >
                  {relativeTime(c.createdAt)}
                </time>
                {can.edit && (
                  <IconButton
                    size="sm"
                    tooltip={false}
                    className={own.remove}
                    label="Remove comment"
                    icon={<Trash2 />}
                    onClick={() => setRemoving(c)}
                  />
                )}
              </div>
              <Markdown className={own.commentBody} text={c.text} />
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this comment?"
        description="Everyone on the map loses it. The map history keeps a record."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </SidebarSection>
  );
}
