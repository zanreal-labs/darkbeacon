// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import {
  routes,
  SUPPORT_MESSAGE_SOURCE,
  type SupportSessionDto,
  type SupportTicketGroupDto,
} from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { SupportScreen } from './SupportPage';

// Radix measures, scrolls and captures the pointer in selects, which jsdom cannot.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const OPENER = 'https://map.example.com';
const MAIN = { id: 2112000001, name: 'Pilot One', main: true };
const ALT = { id: 2112000003, name: 'Pilot Alt', main: false };
const session: SupportSessionDto = {
  available: true,
  backend: 'local',
  feedback: true,
  signedIn: true,
  characters: [MAIN, ALT],
};
const TICKET = {
  id: '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11',
  number: 7,
  category: 'bug' as const,
  status: 'pending' as const,
  unread: 1,
  preview: 'Fixed in 0.1.1',
  lastMessageAt: 2,
  createdAt: 1,
  messageCount: 2,
};

/** Requests the page made: path with query, body, and any header beyond the app's own. */
const created: Array<{ body: unknown; csrf: string | null }> = [];
const handles: Array<{ body: unknown; csrf: string | null }> = [];
const threads: string[] = [];
const server = setupMockServer(
  http.get(routes.support.session.path, () => HttpResponse.json(session)),
  http.get(routes.support.tickets.path, () =>
    HttpResponse.json([
      { character: { id: MAIN.id, name: MAIN.name }, tickets: [] },
      { character: { id: ALT.id, name: ALT.name }, tickets: [TICKET] },
    ] satisfies SupportTicketGroupDto[]),
  ),
  http.get(routes.support.handles.path, () => HttpResponse.json([])),
  http.get('/api/support/tickets/:ticketId/messages', ({ request }) => {
    threads.push(new URL(request.url).search);
    return HttpResponse.json({
      ticket: { ...TICKET, unread: 0 },
      messages: [{ id: 'm1', body: 'Fixed in 0.1.1', author: 'support', authorName: 'Zan', createdAt: 2 }],
    });
  }),
  http.post(routes.support.createTicket.path, async ({ request }) => {
    created.push({ body: await request.json(), csrf: request.headers.get('x-support-csrf') });
    return HttpResponse.json({ id: TICKET.id }, { status: 201 });
  }),
  http.post(routes.support.createHandle.path, async ({ request }) => {
    handles.push({ body: await request.json(), csrf: request.headers.get('x-support-csrf') });
    return HttpResponse.json({ handle: `dbsh_${'a'.repeat(43)}` }, { status: 201 });
  }),
);

function renderHub() {
  return renderWithProviders(
    <TooltipProvider>
      <ToastProvider>
        <SupportScreen />
      </ToastProvider>
    </TooltipProvider>,
  );
}

/** A message as the browser delivers it: from `origin`, sent by `source`. */
function deliver(data: unknown, origin: string, source: MessageEventSource | null = window) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });
}

describe('support hub page', () => {
  let posted: Array<{ message: unknown; target: string }>;

  beforeEach(() => {
    posted = [];
    created.length = 0;
    handles.length = 0;
    threads.length = 0;
    sessionStorage.clear();
    window.history.replaceState(null, '', `/support?kind=ticket&origin=${encodeURIComponent(OPENER)}`);
    // The opener is this window in jsdom; what the page posts to it is recorded, not delivered.
    Object.defineProperty(window, 'opener', { configurable: true, value: window });
    vi.spyOn(window, 'postMessage').mockImplementation(((message: unknown, target: string) => {
      posted.push({ message, target });
    }) as typeof window.postMessage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
  });

  it('asks the opener for the context, accepts it only from the opener’s origin, and lets lines be removed', async () => {
    renderHub();
    await waitFor(() =>
      expect(posted).toContainEqual({
        message: { source: SUPPORT_MESSAGE_SOURCE, type: 'ready' },
        target: OPENER,
      }),
    );
    await screen.findByText('Report a problem or ask for help');

    const context = {
      source: SUPPORT_MESSAGE_SOURCE,
      type: 'context',
      context: { appVersion: '0.1.0', page: 'map', slug: 'home-chain', errors: ['Boom at "J100101"'] },
      optional: { instanceHost: 'map.example.com', mapCounts: { systems: 3, connections: 2, signatures: 9 } },
      hasHandle: false,
    };
    // Another origin, or not the opener: ignored.
    deliver(context, 'https://evil.example');
    deliver(context, OPENER, null);
    expect(screen.queryByText('0.1.0')).toBeNull();

    deliver(context, OPENER);
    expect(await screen.findByText('0.1.0')).toBeTruthy();
    // Not on the allow-list: never shown, never sent.
    expect(screen.queryByText('home-chain')).toBeNull();
    // Error lines are scrubbed again on arrival.
    expect(screen.getByText('Boom at <str>')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove recent error 1' }));
    expect(screen.queryByText('Boom at <str>')).toBeNull();
    // Opt-ins start unticked; tick the map size only.
    fireEvent.click(screen.getByText('Include the current map’s structure counts'));

    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Signatures vanish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send ticket' }));
    await waitFor(() => expect(created).toHaveLength(1));
    // The app session is the credential: no token of the hub's own.
    expect(created[0]).toEqual({
      csrf: null,
      body: {
        characterId: MAIN.id,
        category: 'bug',
        message: 'Signatures vanish',
        context: {
          appVersion: '0.1.0',
          page: 'map',
          mapCounts: { systems: 3, connections: 2, signatures: 9 },
        },
      },
    });
  });

  it('opens a ticket for the main character unless another one of the account is picked', async () => {
    const user = userEvent.setup();
    renderHub();
    const picker = await screen.findByRole('combobox', { name: 'Character' });
    expect(picker.textContent).toContain('Pilot One (main)');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /Pilot Alt/ }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'On my alt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send ticket' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.body).toMatchObject({ characterId: ALT.id, message: 'On my alt' });
  });

  it('lists my tickets per character and opens a thread as its character', async () => {
    window.history.replaceState(null, '', '/support?kind=tickets');
    renderHub();
    // One card per character, main first: the main one has none, the alt one has an answer.
    await screen.findByText('Pilot Alt');
    const counts = screen.getAllByText(/^(No tickets|1 ticket)$/).map((n) => n.textContent);
    expect(counts).toEqual(['No tickets', '1 ticket']);
    expect(screen.getByText('1 new answer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /#7/ }));
    await waitFor(() => expect(threads).toEqual([`?character=${ALT.id}`]));
    expect(await screen.findByText('Zan', { exact: false })).toBeTruthy();
  });

  it('hands the opener an unread handle only after the pilot allows it, and only to its origin', async () => {
    renderHub();
    await screen.findByText('Report a problem or ask for help');
    deliver({ source: SUPPORT_MESSAGE_SOURCE, type: 'context', context: {}, hasHandle: false }, OPENER);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(handles).toHaveLength(1));
    expect(handles[0]).toEqual({ csrf: null, body: { origin: OPENER } });
    await waitFor(() =>
      expect(posted).toContainEqual({
        message: { source: SUPPORT_MESSAGE_SOURCE, type: 'handle', handle: `dbsh_${'a'.repeat(43)}` },
        target: OPENER,
      }),
    );
  });

  it('does not talk to an opener whose origin is not https', async () => {
    window.history.replaceState(null, '', `/support?origin=${encodeURIComponent('http://evil.example')}`);
    renderHub();
    await screen.findByText('Report a problem or ask for help');
    expect(posted).toEqual([]);
  });

  it('sends a signed-out pilot to the app’s sign-in page, and back to this page', async () => {
    server.use(
      http.get(routes.support.session.path, () =>
        HttpResponse.json({ ...session, signedIn: false, characters: [] }),
      ),
    );
    renderHub();
    const link = await screen.findByRole('link', { name: 'Sign in' });
    // A stale session cookie is dropped first (`reset`), so the sign-in page shows instead of
    // bouncing back here; it then returns to this page with the popup's query.
    const href = new URL(link.getAttribute('href')!, 'http://hub.test');
    expect(href.pathname).toBe('/login');
    expect(href.searchParams.get('reset')).toBe('1');
    const login = new URL(href.searchParams.get('next')!, 'http://hub.test');
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('next')).toBe(`/support?kind=ticket&origin=${encodeURIComponent(OPENER)}`);
  });

  it('asks an account without an EVE character to link one first', async () => {
    server.use(
      http.get(routes.support.session.path, () => HttpResponse.json({ ...session, characters: [] })),
    );
    renderHub();
    const link = await screen.findByRole('link', { name: 'Link an EVE character' });
    expect(link.getAttribute('href')).toBe(
      `/api/auth/eve/login?${new URLSearchParams({ returnTo: `/support?kind=ticket&origin=${encodeURIComponent(OPENER)}` })}`,
    );
    expect(screen.queryByRole('button', { name: 'Send ticket' })).toBeNull();
  });
});
