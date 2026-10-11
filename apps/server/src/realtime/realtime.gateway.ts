import type { IncomingMessage } from 'node:http';
import { Inject, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import type { AppConfig } from '../config/config.js';
import { ActorResolverRegistry } from '../platform/actor.js';
import { APP_CONFIG } from '../platform/tokens.js';
import { RealtimeHub, type HubConnection } from './realtime.hub.js';

const HEARTBEAT_MS = 30_000;
/** Client frames are small JSON commands; anything bigger is refused by `ws` (close 1009). */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Close code for a refused origin or an ended session (policy violation). */
const POLICY_VIOLATION = 1008;

/** The `/ws` transport: one hub connection per socket, plus ping/pong liveness checks. */
@WebSocketGateway({ path: '/ws', maxPayload: MAX_FRAME_BYTES })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly sockets = new Map<WebSocket, { hub: HubConnection; alive: boolean }>();
  private readonly heartbeat = setInterval(() => this.checkLiveness(), HEARTBEAT_MS).unref();
  private readonly publicOrigin: string;

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
  }

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    // The socket authenticates with the session cookie, so a page on another origin
    // (even a sibling subdomain, which SameSite lets through) must not open one.
    if (!sameOrigin(request, this.publicOrigin)) {
      socket.close(POLICY_VIOLATION, 'Origin not allowed');
      return;
    }
    const hub = this.hub.connect(
      () => this.actors.resolve({ headers: request.headers }),
      (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
      () => socket.close(POLICY_VIOLATION, 'Signed out'),
    );
    const entry = { hub, alive: true };
    this.sockets.set(socket, entry);
    socket.on('pong', () => (entry.alive = true));
    socket.on('message', (data, isBinary) => {
      if (!isBinary) hub.receive(data.toString());
    });
  }

  handleDisconnect(socket: WebSocket): void {
    this.sockets.get(socket)?.hub.close();
    this.sockets.delete(socket);
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    this.hub.close();
  }

  private checkLiveness(): void {
    for (const [socket, entry] of this.sockets) {
      if (!entry.alive) {
        socket.terminate();
        continue;
      }
      entry.alive = false;
      socket.ping();
    }
  }
}

/**
 * Browsers always send Origin on a WebSocket upgrade. It must be the instance's public origin
 * or the host the request was sent to (a reverse proxy or the dev server in front). Clients
 * without an Origin header are not browsers, so no cookie can be abused through them.
 */
export function sameOrigin(request: IncomingMessage, publicOrigin: string): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (origin === publicOrigin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
