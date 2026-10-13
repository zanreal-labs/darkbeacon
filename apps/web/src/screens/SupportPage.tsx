'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bug,
  CircleHelp,
  Inbox,
  LifeBuoy,
  LogOut,
  MessageSquareHeart,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildPath,
  decodeSupportContext,
  isSupportOrigin,
  readSupportMessage,
  routes,
  sanitizeSupportContext,
  SUPPORT_FEEDBACK_CONSENT,
  SUPPORT_FEEDBACK_MAX,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_SOURCE,
  SUPPORT_TICKET_CONSENT,
  supportContextLines,
  withoutContextLine,
  type SupportCategory,
  type SupportContext,
  type SupportFeedbackKind,
  type SupportHandleCreatedDto,
  type SupportHandleDto,
  type SupportSessionDto,
  type SupportThreadDto,
  type SupportTicketCreatedDto,
  type SupportTicketDto,
  type SupportTicketStatus,
  type SupportWindowMessage,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { IN_APP_CONTEXT_KEY, type SupportKind } from '../lib/support';
import { relativeTime } from '../lib/time';
import { LogoMark } from '../shell/Logo';
import { ThemeMenu } from '../shell/ThemeMenu';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CharacterAvatar,
  Checkbox,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Row,
  Rows,
  Segmented,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
  type Tone,
} from '../ui';
import styles from './SupportPage.module.css';

const sessionKey = ['support-session'] as const;
const ticketsKey = ['support-tickets'] as const;
const handlesKey = ['support-handles'] as const;
const threadKey = (id: string) => ['support-thread', id] as const;

/** Keeps what the opener sent across the EVE sign-in (the popup navigates away and back). */
const STASH_KEY = 'dbk-support-stash';
const DISMISSED_KEY = 'dbk-support-handle-dismissed';

export const STATUS: Record<SupportTicketStatus, { label: string; tone: Tone }> = {
  new: { label: 'Sent', tone: 'accent' },
  open: { label: 'Open', tone: 'accent' },
  pending: { label: 'Answered', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'neutral' },
};

export const CATEGORY: Record<SupportCategory, string> = {
  bug: 'Bug',
  support: 'Help',
  question: 'Question',
};

const OPT_IN = {
  instanceHost: 'Include this instance’s address',
  mapCounts: 'Include the current map’s structure counts',
} as const;
type OptIn = keyof typeof OPT_IN;

interface Stash {
  context: SupportContext;
  optional: SupportContext;
  hasHandle: boolean | null;
}

function readJson(storage: () => Storage, key: string): unknown {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the details are only kept until the page is left.
  }
}

/** Only the opt-in fields of an untrusted object. */
function optionalOf(raw: unknown): SupportContext {
  const { instanceHost, mapCounts } = sanitizeSupportContext(raw);
  return { ...(instanceHost ? { instanceHost } : {}), ...(mapCounts ? { mapCounts } : {}) };
}

/** Requests of the hub's pages: same origin, with the session's CSRF token on changes. */
function hubApi<T>(
  path: string,
  csrf: string | null,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  return api<T>(path, { ...init, headers: { ...(csrf ? { 'x-support-csrf': csrf } : {}), ...init.headers } });
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong; try again.';
}

/**
 * The support hub's page (`/support`), usually in a popup from another instance: open a ticket,
 * send feedback, follow my tickets. The context from the opener is untrusted: it is sanitized to
 * the allow-list and shown line by line, each removable, before anything is sent.
 */
export function SupportScreen() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const initialTab: SupportKind =
    params.get('kind') === 'feedback' ? 'feedback' : params.get('kind') === 'tickets' ? 'tickets' : 'ticket';
  const [tab, setTab] = useState<SupportKind>(initialTab);
  const originParam = params.get('origin');
  const openerOrigin = isSupportOrigin(originParam) ? originParam : null;
  const ctxParam = params.get('ctx');
  const authError = params.get('support_error');

  const session = useQuery({
    queryKey: sessionKey,
    queryFn: () => api<SupportSessionDto>(routes.support.session.path),
    retry: false,
  });

  const [stash, setStash] = useState<Stash>({ context: {}, optional: {}, hasHandle: null });
  const [hasOpener, setHasOpener] = useState(false);

  // The context: from the opener's message, else kept from before the sign-in, else the hub's own
  // app (in-app), else the short `?ctx=`.
  useEffect(() => {
    const kept = readJson(() => sessionStorage, STASH_KEY) as Partial<Stash> | null;
    const inApp = readJson(() => sessionStorage, IN_APP_CONTEXT_KEY) as Partial<Stash> | null;
    const initial: Stash = kept
      ? {
          context: sanitizeSupportContext(kept.context),
          optional: optionalOf(kept.optional),
          hasHandle: kept.hasHandle ?? null,
        }
      : inApp
        ? {
            context: sanitizeSupportContext(inApp.context),
            optional: optionalOf(inApp.optional),
            hasHandle: true,
          }
        : { context: decodeSupportContext(ctxParam), optional: {}, hasHandle: null };
    // The page's first render is the server's; the stored context only exists here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStash(initial);
    writeJson(STASH_KEY, initial);

    const opener = window.opener as Window | null;
    if (!opener || !openerOrigin) return;
    setHasOpener(true);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener) return;
      const message = readSupportMessage(event, openerOrigin);
      if (message?.type !== 'context') return;
      const next: Stash = {
        context: sanitizeSupportContext(message.context),
        optional: optionalOf(message.optional),
        hasHandle: message.hasHandle ?? null,
      };
      setStash(next);
      writeJson(STASH_KEY, next);
    };
    window.addEventListener('message', onMessage);
    const ready: SupportWindowMessage = { source: SUPPORT_MESSAGE_SOURCE, type: 'ready' };
    opener.postMessage(ready, openerOrigin);
    return () => window.removeEventListener('message', onMessage);
  }, [openerOrigin, ctxParam]);

  const data = session.data;
  const signedIn = !!data?.character;
  const csrf = data?.csrf ?? null;
  const returnTo = `/support?kind=${tab}${openerOrigin ? `&origin=${encodeURIComponent(openerOrigin)}` : ''}`;
  const signInHref = `/support/login?returnTo=${encodeURIComponent(returnTo)}`;

  const logout = useMutation({
    mutationFn: () => hubApi<void>(routes.support.logout.path, null, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKey }),
  });

  const tickets = useQuery({
    queryKey: ticketsKey,
    queryFn: () => api<SupportTicketDto[]>(routes.support.tickets.path),
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const unread = (tickets.data ?? []).reduce((sum, t) => sum + t.unread, 0);

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <LogoMark size={22} />
          <span className={styles.brandText}>Darkbeacon support</span>
        </div>
        <div className={styles.topActions}>
          {data?.character && (
            <span className={styles.who}>
              <CharacterAvatar id={data.character.id} name={data.character.name} size={24} />
              <span className={styles.whoName}>{data.character.name}</span>
              <IconButton
                label="Sign out"
                icon={<LogOut />}
                size="sm"
                loading={logout.isPending}
                onClick={() => logout.mutate()}
              />
            </span>
          )}
          <ThemeMenu />
        </div>
      </header>

      <main className={styles.main}>
        {authError && (
          <Callout tone="danger" title="Sign-in did not work">
            {authError}
          </Callout>
        )}
        {session.isError ? (
          <ErrorState error={session.error} onRetry={() => void session.refetch()} />
        ) : !data ? (
          <Skeleton height={320} radius={12} />
        ) : !data.available ? (
          <EmptyState
            icon={<LifeBuoy />}
            title="Support is not set up on this instance"
            description="Tickets and feedback go to the support hub its admins chose. Use the help menu in the app."
            actions={
              <Button asChild>
                <Link href="/">Back to Darkbeacon</Link>
              </Button>
            }
          />
        ) : (
          <>
            {signedIn && hasOpener && openerOrigin && stash.hasHandle === false && (
              <AllowUnread origin={openerOrigin} csrf={csrf} />
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(v as SupportKind)}>
              <TabsList className={styles.tabs} aria-label="Support">
                <TabsTrigger value="ticket" icon={<Bug />}>
                  New ticket
                </TabsTrigger>
                <TabsTrigger value="feedback" icon={<MessageSquareHeart />}>
                  Feedback
                </TabsTrigger>
                <TabsTrigger value="tickets" icon={<Inbox />}>
                  My tickets
                  {unread > 0 && (
                    <Badge tone="accent" className={styles.tabBadge}>
                      {unread}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ticket">
                {signedIn ? (
                  <NewTicket
                    csrf={csrf}
                    stash={stash}
                    onContext={(context) => {
                      const next = { ...stash, context };
                      setStash(next);
                      writeJson(STASH_KEY, next);
                    }}
                    onSent={() => setTab('tickets')}
                  />
                ) : (
                  <SignIn
                    href={signInHref}
                    why="Tickets are linked to the EVE character you sign in with, so you can follow the answer from any Darkbeacon instance."
                  />
                )}
              </TabsContent>
              <TabsContent value="feedback">
                <Feedback session={data} stash={stash} />
              </TabsContent>
              <TabsContent value="tickets">
                {signedIn ? (
                  <MyTickets
                    csrf={csrf}
                    tickets={tickets.data}
                    error={tickets.error}
                    onNew={() => setTab('ticket')}
                  />
                ) : (
                  <SignIn
                    href={signInHref}
                    why="Sign in with the character you opened your tickets with to read the answers."
                  />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
        {!hasOpener && (
          <p className={styles.back}>
            <Link href="/">Back to Darkbeacon</Link>
          </p>
        )}
      </main>
    </div>
  );
}

function SignIn({ href, why }: { href: string; why: ReactNode }) {
  return (
    <Card>
      <CardHeader title="Sign in with EVE Online" description={why} />
      <CardBody>
        <p className={styles.muted}>
          Sign-in only: no ESI access is asked for and no token is kept. Your instance account is not
          involved.
        </p>
      </CardBody>
      <CardFooter>
        <Button asChild variant="primary">
          <a href={href}>Sign in with EVE Online</a>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Offers the opener a handle for the unread badge (once per instance; revocable below the tickets). */
function AllowUnread({ origin, csrf }: { origin: string; csrf: string | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(() => readJson(() => sessionStorage, DISMISSED_KEY) === origin);
  const allow = useMutation({
    mutationFn: () =>
      hubApi<SupportHandleCreatedDto>(routes.support.createHandle.path, csrf, {
        method: 'POST',
        json: { origin },
      }),
    onSuccess: ({ handle }) => {
      const opener = window.opener as Window | null;
      const message: SupportWindowMessage = { source: SUPPORT_MESSAGE_SOURCE, type: 'handle', handle };
      opener?.postMessage(message, origin);
      writeJson(DISMISSED_KEY, origin);
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: handlesKey });
      toast({ title: `Answers will show on ${new URL(origin).host}`, tone: 'success' });
    },
    onError: (error) => toast({ title: 'Could not allow it', description: errorText(error), tone: 'danger' }),
  });
  if (dismissed) return null;
  return (
    <Callout tone="accent" title={`Show answers on ${new URL(origin).host}?`}>
      <p className={styles.calloutText}>
        That Darkbeacon instance would see how many answers you have not read yet (a number, nothing else) and
        show it on its help icon. You can take it back here at any time.
      </p>
      <div className={styles.calloutActions}>
        <Button size="sm" variant="primary" loading={allow.isPending} onClick={() => allow.mutate()}>
          Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            writeJson(DISMISSED_KEY, origin);
            setDismissed(true);
          }}
        >
          Not now
        </Button>
      </div>
    </Callout>
  );
}

function NewTicket({
  csrf,
  stash,
  onContext,
  onSent,
}: {
  csrf: string | null;
  stash: Stash;
  onContext(context: SupportContext): void;
  onSent(): void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SupportCategory>('bug');
  const [message, setMessage] = useState('');
  const [ticked, setTicked] = useState<Record<OptIn, boolean>>({ instanceHost: false, mapCounts: false });
  const lines = supportContextLines(stash.context);
  const offered = (Object.keys(OPT_IN) as OptIn[]).filter((key) => stash.optional[key] !== undefined);

  const send = useMutation({
    mutationFn: () => {
      const context: SupportContext = { ...stash.context };
      for (const key of offered) if (ticked[key]) Object.assign(context, { [key]: stash.optional[key] });
      return hubApi<SupportTicketCreatedDto>(routes.support.createTicket.path, csrf, {
        method: 'POST',
        json: { category, message, context },
      });
    },
    onSuccess: async () => {
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: ticketsKey });
      toast({
        title: 'Ticket sent',
        description: 'The answer will show up under My tickets.',
        tone: 'success',
      });
      onSent();
    },
    onError: (error) =>
      toast({ title: 'Could not send the ticket', description: errorText(error), tone: 'danger' }),
  });

  return (
    <Card>
      <CardHeader
        title="Report a problem or ask for help"
        description="One ticket per problem; you can add to it later."
      />
      <CardBody className={styles.form}>
        <ChoiceGroup
          aria-label="What is it about?"
          value={category}
          onValueChange={(v) => setCategory(v as SupportCategory)}
          options={[
            {
              value: 'bug',
              label: 'Something is broken',
              description: 'An error, a wrong result, a page that does not load',
              icon: <Bug />,
            },
            {
              value: 'support',
              label: 'I need a hand',
              description: 'Setting up, signing in, sharing, importing',
              icon: <LifeBuoy />,
            },
            {
              value: 'question',
              label: 'A question',
              description: 'How something works, or whether it can',
              icon: <CircleHelp />,
            },
          ]}
        />
        <Field label="What happened?" hint="What you did, what you expected, and what happened instead.">
          <Textarea
            rows={6}
            maxLength={SUPPORT_MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="When I paste signatures in J-space…"
          />
        </Field>
        <p className={styles.consent}>{SUPPORT_TICKET_CONSENT}</p>
        <section className={styles.details} aria-labelledby="support-details">
          <h3 id="support-details" className={styles.detailsTitle}>
            Sent with your ticket
          </h3>
          {lines.length === 0 ? (
            <p className={styles.muted}>Nothing but your message and your character.</p>
          ) : (
            <ul className={styles.lines}>
              {lines.map((line) => (
                <li key={line.id} className={styles.line}>
                  <span className={styles.lineLabel}>{line.label}</span>
                  <span className={styles.lineValue}>{line.value}</span>
                  <IconButton
                    label={`Remove ${line.label.toLowerCase()}`}
                    icon={<X />}
                    size="sm"
                    onClick={() => onContext(withoutContextLine(stash.context, line.id))}
                  />
                </li>
              ))}
            </ul>
          )}
          {offered.map((key) => (
            <Checkbox
              key={key}
              checked={ticked[key]}
              onCheckedChange={(on) => setTicked((t) => ({ ...t, [key]: on }))}
              label={OPT_IN[key]}
              description={supportContextLines({ [key]: stash.optional[key] } as SupportContext)[0]?.value}
            />
          ))}
        </section>
      </CardBody>
      <CardFooter>
        <Button
          variant="primary"
          icon={<Send />}
          loading={send.isPending}
          disabled={message.trim().length === 0}
          onClick={() => send.mutate()}
        >
          Send ticket
        </Button>
      </CardFooter>
    </Card>
  );
}

function Feedback({ session, stash }: { session: SupportSessionDto; stash: Stash }) {
  const toast = useToast();
  const [kind, setKind] = useState<SupportFeedbackKind>('quick');
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      hubApi<void>(routes.support.feedback.path, session.csrf, {
        method: 'POST',
        json: {
          kind,
          ...(kind === 'quick' && rating !== null ? { rating } : {}),
          text,
          context: {
            ...(stash.context.appVersion ? { appVersion: stash.context.appVersion } : {}),
            ...(stash.context.page ? { page: stash.context.page } : {}),
            ...(stash.context.viewport ? { viewport: stash.context.viewport } : {}),
          },
        },
      }),
    onSuccess: () => {
      setSent(true);
      setText('');
      setRating(null);
    },
    onError: (error) => toast({ title: 'Could not send it', description: errorText(error), tone: 'danger' }),
  });

  if (!session.feedback)
    return (
      <EmptyState
        icon={<MessageSquareHeart />}
        title="Feedback is not set up on this hub"
        description="Open a ticket instead."
      />
    );
  if (sent)
    return (
      <EmptyState
        icon={<MessageSquareHeart />}
        title="Thank you"
        description="Every answer is read. If you need a reply, open a ticket."
        actions={<Button onClick={() => setSent(false)}>Send more</Button>}
      />
    );
  const ready = kind === 'quick' ? rating !== null || text.trim() !== '' : text.trim() !== '';
  return (
    <Card>
      <CardHeader
        title="Send feedback"
        description={session.character ? `As ${session.character.name}.` : 'Anonymous.'}
        actions={
          <Segmented
            aria-label="Kind of feedback"
            value={kind}
            onValueChange={(v) => setKind(v as SupportFeedbackKind)}
            options={[
              { value: 'quick', label: 'Quick feedback' },
              { value: 'feature', label: 'Feature request' },
            ]}
          />
        }
      />
      <CardBody className={styles.form}>
        {kind === 'quick' && (
          <div className={styles.rating} role="radiogroup" aria-label="How is Darkbeacon working for you?">
            <span className={styles.ratingLabel}>How is Darkbeacon working for you?</span>
            <div className={styles.ratingScale}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  className={styles.ratingButton}
                  data-on={rating === n || undefined}
                  onClick={() => setRating(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className={styles.ratingEnds}>
              <span>Not well</span>
              <span>Very well</span>
            </span>
          </div>
        )}
        <Field
          label={kind === 'quick' ? 'Anything to add?' : 'What would you like Darkbeacon to do?'}
          optional={kind === 'quick'}
          hint={
            kind === 'feature' ? 'What you are trying to do, and how it would help your group.' : undefined
          }
        >
          <Textarea
            rows={5}
            maxLength={SUPPORT_FEEDBACK_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <p className={styles.consent}>{SUPPORT_FEEDBACK_CONSENT}</p>
      </CardBody>
      <CardFooter>
        <Button
          variant="primary"
          icon={<Send />}
          loading={send.isPending}
          disabled={!ready}
          onClick={() => send.mutate()}
        >
          Send feedback
        </Button>
      </CardFooter>
    </Card>
  );
}

function MyTickets({
  csrf,
  tickets,
  error,
  onNew,
}: {
  csrf: string | null;
  tickets: SupportTicketDto[] | undefined;
  error: unknown;
  onNew(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <Thread id={open} csrf={csrf} onBack={() => setOpen(null)} />;
  return (
    <>
      <Card>
        <CardHeader title="My tickets" description="Answers from the Darkbeacon maintainers show up here." />
        <CardBody flush>
          {error ? (
            <ErrorState compact error={error} />
          ) : !tickets ? (
            <Skeleton height={120} />
          ) : tickets.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title="No tickets yet"
              description="Report a problem or ask for help, and follow the answer here."
              actions={<Button onClick={onNew}>New ticket</Button>}
            />
          ) : (
            <Rows>
              {tickets.map((t) => (
                <li key={t.id} className={styles.ticketRow}>
                  <button type="button" className={styles.ticketButton} onClick={() => setOpen(t.id)}>
                    <span className={styles.ticketTitle}>
                      <span className={styles.ticketNumber}>
                        {t.number !== null ? `#${t.number}` : 'Ticket'}
                      </span>
                      {t.category && <span className={styles.ticketCategory}>{CATEGORY[t.category]}</span>}
                      <Badge tone={STATUS[t.status].tone} dot>
                        {STATUS[t.status].label}
                      </Badge>
                      {t.unread > 0 && (
                        <Badge tone="accent">
                          {t.unread === 1 ? '1 new answer' : `${t.unread} new answers`}
                        </Badge>
                      )}
                    </span>
                    <span className={styles.ticketPreview}>{t.preview ?? ''}</span>
                    <span className={styles.ticketMeta}>
                      {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'} ·{' '}
                      {relativeTime(t.lastMessageAt ?? t.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </Rows>
          )}
        </CardBody>
      </Card>
      <Handles csrf={csrf} />
    </>
  );
}

function Thread({ id, csrf, onBack }: { id: string; csrf: string | null; onBack(): void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const thread = useQuery({
    queryKey: threadKey(id),
    queryFn: () => api<SupportThreadDto>(buildPath(routes.support.messages.path, { ticketId: id })),
    refetchInterval: 60_000,
  });
  const unread = thread.data?.ticket.unread ?? 0;
  useEffect(() => {
    if (unread === 0) return;
    void hubApi<void>(buildPath(routes.support.markRead.path, { ticketId: id }), csrf, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: ticketsKey }))
      .catch(() => {});
  }, [unread, id, csrf, queryClient]);
  const send = useMutation({
    mutationFn: () =>
      hubApi<SupportThreadDto>(buildPath(routes.support.reply.path, { ticketId: id }), csrf, {
        method: 'POST',
        json: { message: reply },
      }),
    onSuccess: (data) => {
      setReply('');
      queryClient.setQueryData(threadKey(id), data);
      void queryClient.invalidateQueries({ queryKey: ticketsKey });
    },
    onError: (error) => toast({ title: 'Could not send it', description: errorText(error), tone: 'danger' }),
  });
  const ticket = thread.data?.ticket;
  return (
    <Card>
      <CardHeader
        icon={<IconButton label="All tickets" icon={<ArrowLeft />} size="sm" onClick={onBack} />}
        title={
          ticket
            ? `${ticket.number !== null ? `#${ticket.number}` : 'Ticket'}${ticket.category ? ` · ${CATEGORY[ticket.category]}` : ''}`
            : 'Ticket'
        }
        description={ticket ? `Opened ${relativeTime(ticket.createdAt)}` : undefined}
        actions={
          ticket && (
            <Badge tone={STATUS[ticket.status].tone} dot>
              {STATUS[ticket.status].label}
            </Badge>
          )
        }
      />
      <CardBody>
        {thread.isError ? (
          <ErrorState compact error={thread.error} onRetry={() => void thread.refetch()} />
        ) : !thread.data ? (
          <Skeleton height={160} />
        ) : (
          <ol className={styles.messages}>
            {thread.data.messages.map((m) => (
              <li key={m.id} className={styles.message} data-author={m.author}>
                <span className={styles.messageMeta}>
                  {m.author === 'you' ? 'You' : (m.authorName ?? 'Support')} · {relativeTime(m.createdAt)}
                </span>
                <div className={styles.messageBody}>{m.body}</div>
              </li>
            ))}
          </ol>
        )}
        <Field label="Reply" className={styles.replyField}>
          <Textarea
            rows={3}
            maxLength={SUPPORT_MESSAGE_MAX}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
        </Field>
      </CardBody>
      <CardFooter>
        <Button
          variant="primary"
          icon={<Send />}
          loading={send.isPending}
          disabled={!reply.trim()}
          onClick={() => send.mutate()}
        >
          Send reply
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Instances allowed to show this character's unread count; revocable. */
function Handles({ csrf }: { csrf: string | null }) {
  const queryClient = useQueryClient();
  const handles = useQuery({
    queryKey: handlesKey,
    queryFn: () => api<SupportHandleDto[]>(routes.support.handles.path),
  });
  const revoke = useMutation({
    mutationFn: (handleId: string) =>
      hubApi<void>(buildPath(routes.support.revokeHandle.path, { handleId }), csrf, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: handlesKey }),
  });
  if (!handles.data?.length) return null;
  return (
    <Card>
      <CardHeader
        title="Instances that show your unread answers"
        description="They see a number on their help icon, nothing else."
      />
      <CardBody flush>
        <Rows>
          {handles.data.map((h) => (
            <Row
              key={h.id}
              title={new URL(h.origin).host}
              meta={`Allowed ${relativeTime(h.createdAt)}${h.lastUsedAt ? ` · last checked ${relativeTime(h.lastUsedAt)}` : ''}`}
              actions={
                <IconButton
                  label={`Stop showing answers on ${new URL(h.origin).host}`}
                  icon={<Trash2 />}
                  size="sm"
                  onClick={() => revoke.mutate(h.id)}
                />
              }
            />
          ))}
        </Rows>
      </CardBody>
    </Card>
  );
}
