import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { routes } from '@wormwright/shared';
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
  const server = setupServer(...handlers, themes);
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
