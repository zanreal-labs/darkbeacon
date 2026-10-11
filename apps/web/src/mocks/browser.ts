import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { WebSocketInterceptor } from '@mswjs/interceptors/WebSocket';
import { defineNetwork, InterceptorSource } from 'msw/experimental';
import { createMockApi } from './handlers';

/**
 * Starts the mocked API in the page (only in `vite --mode mock`). It patches fetch and
 * WebSocket directly instead of registering a service worker, so it also runs in embedded
 * browsers without service worker support.
 */
export async function startMockApi(): Promise<void> {
  const { handlers } = createMockApi();
  const network = defineNetwork({
    sources: [new InterceptorSource({ interceptors: [new FetchInterceptor(), new WebSocketInterceptor()] })],
    handlers,
    onUnhandledFrame: 'bypass',
    context: { quiet: true },
  });
  await network.enable();
}
