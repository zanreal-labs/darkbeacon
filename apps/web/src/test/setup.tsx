import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { DEFAULT_ROUTE_PREFERENCES, routes } from '@darkbeacon/shared';
import type { ReactElement, ReactNode } from 'react';
import { RealtimeClient } from '../lib/realtime';
import { RealtimeProvider } from '../lib/RealtimeProvider';
import { ThemeProvider } from '../theme/ThemeProvider';

/**
 * Shared helpers for component tests (jsdom). Import once per test file; it registers the
 * cleanup hooks itself.
 */
afterEach(() => cleanup());

/** React Flow measures nodes with ResizeObserver and DOMMatrix, which jsdom lacks. */
export function installFlowMocks(size = { width: 160, height: 60 }) {
  globalThis.ResizeObserver ??= class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const rect = { width: size.width, height: size.height };
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
  globalThis.DOMMatrixReadOnly ??= class {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  } as unknown as typeof DOMMatrixReadOnly;
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => size.width },
    offsetHeight: { configurable: true, get: () => size.height },
  });
  (SVGElement.prototype as unknown as { getBBox(): DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}

/** An MSW server for the test file, started before and closed after its tests. */
export function setupMockServer(...handlers: Parameters<typeof setupServer>) {
  // ThemeProvider asks for installed themes; without them it keeps the built-in ones.
  const themes = http.get(routes.themes.list.path, () => new HttpResponse(null, { status: 404 }));
  // Widgets load their own lists; empty unless a test says otherwise.
  const empty = [
    routes.comments.list.path,
    routes.structures.list.path,
    routes.audit.systemHistory.path,
    routes.connections.intel.path,
  ].map((path) =>
    http.get(path, () =>
      HttpResponse.json(path === routes.audit.systemHistory.path ? { entries: [], nextCursor: null } : []),
    ),
  );
  const wormholes = http.get(routes.universe.wormholes.path, () =>
    HttpResponse.json({ types: [], hullClasses: [] }),
  );
  // The routes section asks for the viewer's route options, hubs and routes; none by default.
  const routing = [
    http.get(routes.routing.preferences.path, () => HttpResponse.json(DEFAULT_ROUTE_PREFERENCES)),
    http.get(routes.routing.hubs.path, () => HttpResponse.json({ trade: [], map: [], personal: [] })),
    http.get(routes.routing.exits.path, () => HttpResponse.json({ mode: 'shortest', exits: [] })),
    http.get(routes.routing.hubRoutes.path, ({ request }) =>
      HttpResponse.json({
        from: Number(new URL(request.url).searchParams.get('from')),
        mode: 'shortest',
        routes: [],
        limit: 20,
      }),
    ),
  ];
  // My preferences and my settings on a map: nothing set yet.
  const characters = [
    http.get(routes.characters.preferences.path, () => HttpResponse.json({ preferences: {}, updatedAt: 0 })),
    http.get(routes.characters.mapSettings.path, () =>
      HttpResponse.json({ mainCharacterId: null, followCharacterId: null }),
    ),
  ];
  const server = setupServer(...handlers, themes, ...empty, wormholes, ...routing, ...characters);
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

/** A WebSocket stand-in the test drives by hand. */
export class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

export function fakeRealtime() {
  return new RealtimeClient({ url: 'ws://test/ws', createSocket: () => new FakeSocket() });
}

export function renderWithProviders(
  ui: ReactElement,
  { realtime = fakeRealtime(), ...options }: { realtime?: RealtimeClient } & RenderOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider client={realtime}>{children}</RealtimeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
  return { ...render(ui, { wrapper, ...options }), queryClient, realtime };
}
