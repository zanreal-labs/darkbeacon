// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { routes, SUPPORT_MESSAGE_SOURCE, type SupportSessionDto } from '@darkbeacon/shared';
import { renderWithProviders, setupMockServer } from '../test/setup';
import { ToastProvider, TooltipProvider } from '../ui';
import { SupportScreen } from './SupportPage';

const OPENER = 'https://map.example.com';
const CSRF = 'csrf-token-123';
const session: SupportSessionDto = {
  available: true,
  backend: 'local',
  feedback: true,
  character: { id: 2112000001, name: 'Pilot One' },
  csrf: CSRF,
};

const created: Array<{ body: unknown; csrf: string | null }> = [];
const handles: Array<{ body: unknown; csrf: string | null }> = [];
const server = setupMockServer(
  http.get(routes.support.session.path, () => HttpResponse.json(session)),
  http.get(routes.support.tickets.path, () => HttpResponse.json([])),
  http.get(routes.support.handles.path, () => HttpResponse.json([])),
  http.post(routes.support.createTicket.path, async ({ request }) => {
    created.push({ body: await request.json(), csrf: request.headers.get('x-support-csrf') });
    return HttpResponse.json({ id: '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11' }, { status: 201 });
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
    expect(created[0]).toEqual({
      csrf: CSRF,
      body: {
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

  it('hands the opener an unread handle only after the pilot allows it, and only to its origin', async () => {
    renderHub();
    await screen.findByText('Report a problem or ask for help');
    deliver({ source: SUPPORT_MESSAGE_SOURCE, type: 'context', context: {}, hasHandle: false }, OPENER);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(handles).toHaveLength(1));
    expect(handles[0]).toEqual({ csrf: CSRF, body: { origin: OPENER } });
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

  it('asks to sign in before a ticket', async () => {
    server.use(
      http.get(routes.support.session.path, () =>
        HttpResponse.json({ ...session, character: null, csrf: null }),
      ),
    );
    renderHub();
    const link = await screen.findByRole('link', { name: 'Sign in with EVE Online' });
    expect(link.getAttribute('href')).toBe(
      `/support/login?returnTo=${encodeURIComponent(`/support?kind=ticket&origin=${encodeURIComponent(OPENER)}`)}`,
    );
  });
});
