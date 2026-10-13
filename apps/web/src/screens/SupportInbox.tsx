'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Inbox, MessageSquareHeart, Send } from 'lucide-react';
import {
  buildPath,
  routes,
  supportContextLines,
  type AdminSupportFeedbackDto,
  type AdminSupportInboxDto,
  type AdminSupportThreadDto,
  type AdminSupportTicketsQuery,
  type SupportPriority,
  type SupportTicketStatus,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CharacterAvatar,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Rows,
  Segmented,
  Select,
  Skeleton,
  Stack,
  Textarea,
  useToast,
} from '../ui';
import { CATEGORY, STATUS } from './SupportPage';
import styles from './SupportInbox.module.css';

type Filter = AdminSupportTicketsQuery['status'];

const inboxKey = (filter: Filter) => ['admin-support', filter] as const;
const ticketKey = (id: string) => ['admin-support-ticket', id] as const;
const feedbackKey = ['admin-support-feedback'] as const;

const PRIORITY: Record<SupportPriority, string> = { low: 'Low', medium: 'Normal', high: 'High' };
/** On the inbox a ticket waiting on the team reads differently from the pilot's view. */
const STAFF_STATUS: Record<SupportTicketStatus, string> = {
  new: 'New',
  open: 'Waiting on us',
  pending: 'Waiting on the pilot',
  on_hold: 'On hold',
  resolved: 'Resolved',
};

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Try again.');

/** Admin > Support: tickets and feedback a hub keeps itself, answered here. */
export function SupportInboxTab() {
  const [filter, setFilter] = useState<Filter>('active');
  const [open, setOpen] = useState<string | null>(null);
  const inbox = useQuery({
    queryKey: inboxKey(filter),
    queryFn: () => api<AdminSupportInboxDto>(`${routes.support.adminTickets.path}?status=${filter}`),
    refetchInterval: 60_000,
  });
  if (open) return <TicketDetail id={open} onBack={() => setOpen(null)} />;
  return (
    <Stack>
      <Card>
        <CardHeader
          title="Support inbox"
          description={
            inbox.data
              ? inbox.data.unanswered === 0
                ? 'Every ticket is answered.'
                : `${inbox.data.unanswered} ${inbox.data.unanswered === 1 ? 'ticket waits' : 'tickets wait'} for an answer.`
              : 'Tickets pilots opened on this hub.'
          }
          actions={
            <Segmented
              aria-label="Which tickets"
              value={filter}
              onValueChange={(v) => setFilter(v as Filter)}
              options={[
                { value: 'active', label: 'Open' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
        />
        <CardBody flush>
          {inbox.isError ? (
            <ErrorState compact error={inbox.error} onRetry={() => void inbox.refetch()} />
          ) : !inbox.data ? (
            <Skeleton height={160} />
          ) : inbox.data.tickets.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title="No tickets here"
              description="New tickets show up as pilots send them."
            />
          ) : (
            <Rows>
              {inbox.data.tickets.map((t) => (
                <li key={t.id} className={styles.row}>
                  <button type="button" className={styles.rowButton} onClick={() => setOpen(t.id)}>
                    <CharacterAvatar id={t.character.id} name={t.character.name} size={32} />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        <strong>#{t.number}</strong>
                        <span>{t.character.name}</span>
                        {t.category && <span className={styles.muted}>{CATEGORY[t.category]}</span>}
                        {t.unread > 0 && <Badge tone="accent">{t.unread} new</Badge>}
                        {t.priority === 'high' && <Badge tone="danger">High</Badge>}
                      </span>
                      <span className={styles.preview}>{t.preview}</span>
                    </span>
                    <span className={styles.rowSide}>
                      <Badge tone={STATUS[t.status].tone} dot>
                        {STAFF_STATUS[t.status]}
                      </Badge>
                      <span className={styles.muted}>{relativeTime(t.lastMessageAt ?? t.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </Rows>
          )}
        </CardBody>
      </Card>
      <FeedbackCard />
    </Stack>
  );
}

function TicketDetail({ id, onBack }: { id: string; onBack(): void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const ticket = useQuery({
    queryKey: ticketKey(id),
    queryFn: () => api<AdminSupportThreadDto>(buildPath(routes.support.adminTicket.path, { ticketId: id })),
  });
  const saved = (data: AdminSupportThreadDto) => {
    queryClient.setQueryData(ticketKey(id), data);
    void queryClient.invalidateQueries({ queryKey: ['admin-support'] });
  };
  const reply = useMutation({
    mutationFn: () =>
      api<AdminSupportThreadDto>(buildPath(routes.support.adminReply.path, { ticketId: id }), {
        method: 'POST',
        json: { message: answer },
      }),
    onSuccess: (data) => {
      setAnswer('');
      saved(data);
      toast({ title: 'Answer sent', description: 'The pilot sees it as unread.', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not send the answer', description: errorText(error), tone: 'danger' }),
  });
  const update = useMutation({
    mutationFn: (change: { status?: SupportTicketStatus; priority?: SupportPriority }) =>
      api<AdminSupportThreadDto>(buildPath(routes.support.adminUpdate.path, { ticketId: id }), {
        method: 'PATCH',
        json: change,
      }),
    onSuccess: saved,
    onError: (error) => toast({ title: 'Could not save', description: errorText(error), tone: 'danger' }),
  });
  const data = ticket.data;
  return (
    <Stack>
      <Card>
        <CardHeader
          icon={<IconButton label="All tickets" icon={<ArrowLeft />} size="sm" onClick={onBack} />}
          title={data ? `#${data.ticket.number} · ${data.ticket.character.name}` : 'Ticket'}
          description={
            data
              ? `${data.ticket.category ? `${CATEGORY[data.ticket.category]} · ` : ''}opened ${relativeTime(data.ticket.createdAt)}`
              : undefined
          }
        />
        <CardBody>
          {ticket.isError ? (
            <ErrorState compact error={ticket.error} onRetry={() => void ticket.refetch()} />
          ) : !data ? (
            <Skeleton height={200} />
          ) : (
            <div className={styles.detail}>
              <div className={styles.controls}>
                <Field label="Status">
                  <Select
                    value={data.ticket.status}
                    onValueChange={(status) => update.mutate({ status: status as SupportTicketStatus })}
                    options={(Object.keys(STAFF_STATUS) as SupportTicketStatus[]).map((s) => ({
                      value: s,
                      label: STAFF_STATUS[s],
                    }))}
                  />
                </Field>
                <Field label="Priority">
                  <Select
                    value={data.ticket.priority}
                    onValueChange={(priority) => update.mutate({ priority: priority as SupportPriority })}
                    options={(Object.keys(PRIORITY) as SupportPriority[]).map((p) => ({
                      value: p,
                      label: PRIORITY[p],
                    }))}
                  />
                </Field>
              </div>
              <ol className={styles.messages}>
                {data.messages.map((m) => (
                  <li key={m.id} className={styles.message} data-author={m.author}>
                    <span className={styles.messageMeta}>
                      {m.author === 'customer' ? data.ticket.character.name : (m.authorName ?? 'Support')} ·{' '}
                      {relativeTime(m.createdAt)}
                    </span>
                    <div className={styles.messageBody}>{m.body}</div>
                  </li>
                ))}
              </ol>
              <details className={styles.context} open>
                <summary>Sent with the ticket</summary>
                {supportContextLines(data.context).length === 0 ? (
                  <p className={styles.muted}>Nothing but the message.</p>
                ) : (
                  <dl className={styles.facts}>
                    {supportContextLines(data.context).map((line) => (
                      <div key={line.id} className={styles.fact}>
                        <dt>{line.label}</dt>
                        <dd>{line.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </details>
              <Field
                label="Answer"
                hint="The pilot sees it on any Darkbeacon instance, signed in with this character."
              >
                <Textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </Field>
            </div>
          )}
        </CardBody>
        <CardFooter>
          <Button
            variant="primary"
            icon={<Send />}
            loading={reply.isPending}
            disabled={!answer.trim() || !data}
            onClick={() => reply.mutate()}
          >
            Send answer
          </Button>
        </CardFooter>
      </Card>
    </Stack>
  );
}

function FeedbackCard() {
  const feedback = useQuery({
    queryKey: feedbackKey,
    queryFn: () => api<AdminSupportFeedbackDto[]>(routes.support.adminFeedback.path),
  });
  return (
    <Card>
      <CardHeader title="Feedback" description="Ratings and feature requests; nobody expects an answer." />
      <CardBody flush>
        {feedback.isError ? (
          <ErrorState compact error={feedback.error} />
        ) : !feedback.data ? (
          <Skeleton height={100} />
        ) : feedback.data.length === 0 ? (
          <EmptyState compact icon={<MessageSquareHeart />} title="No feedback yet" />
        ) : (
          <Rows>
            {feedback.data.map((f) => (
              <li key={f.id} className={styles.feedback}>
                <span className={styles.rowTitle}>
                  <Badge tone={f.kind === 'feature' ? 'accent' : 'neutral'}>
                    {f.kind === 'feature' ? 'Feature request' : 'Quick feedback'}
                  </Badge>
                  {f.rating !== null && <span className={styles.rating}>{f.rating} of 5</span>}
                  <span className={styles.muted}>
                    {f.character ? f.character.name : 'Anonymous'} · {relativeTime(f.createdAt)}
                  </span>
                </span>
                {f.text && <p className={styles.feedbackText}>{f.text}</p>}
              </li>
            ))}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}
