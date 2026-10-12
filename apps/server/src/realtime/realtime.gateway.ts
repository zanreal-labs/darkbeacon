import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Inject, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import type { AppConfig } from '../config/config.js';
import { RESTORED_CLOSE_CODE } from '@darkbeacon/shared';
import { ActorResolverRegistry } from '../platform/actor.js';
import { clientAddress } from '../platform/client-address.js';
import { MaintenanceMode } from '../platform/maintenance.js';
import { APP_CONFIG } from '../platform/tokens.js';
import { RealtimeHub, type HubConnection } from './realtime.hub.js';

const HEARTBEAT_MS = 30_000;
/** Client frames are small JSON commands; anything bigger is refused by `ws` (close 1009). */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Close code for a refused origin or an ended session (policy violation). */
const POLICY_VIOLATION = 1008;
/** Close code for "try again later" (maintenance). */
const TRY_AGAIN_LATER = 1013;

/**
 * The `/ws` transport: one hub connection per socket, plus ping/pong liveness checks.
 *
 * No permessage-deflate: browsers then compress every frame they send, and inflating 150
 * cursors at 15 Hz each (zlib on libuv's thread pool, in order per socket) cost more than a
 * fifth of the server's CPU in load tests and held back the session hashing that shares the
 * pool. Snapshots, the only big frames, come over HTTP with the page (gzip) and are replayed
 * from there; a socket gets one only after a long disconnect.
 */
@WebSocketGateway({ path: '/ws', maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly sockets = new Map<WebSocket, { hub: HubConnection; alive: boolean }>();
  private readonly heartbeat = setInterval(() => this.checkLiveness(), HEARTBEAT_MS).unref();
  private readonly publicOrigin: string;

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
  }

  onModuleInit(): void {
    // After a restore the seqs a client holds belong to the old database: it must start over.
    this.maintenance.register({
      name: 'realtime',
      resume: (restored) => {
        if (restored) this.closeAll(RESTORED_CLOSE_CODE, 'Database restored');
      },
    });
  }

  /** Closes every socket; clients reconnect on their own. */
  closeAll(code: number, reason: string): void {
    for (const socket of this.sockets.keys()) socket.close(code, reason);
  }

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    // The socket authenticates with the session cookie, so a page on another origin
    // (even a sibling subdomain, which SameSite lets through) must not open one.
    if (!sameOrigin(request, this.publicOrigin)) {
      socket.close(POLICY_VIOLATION, 'Origin not allowed');
      return;
    }
    if (this.maintenance.active) {
      socket.close(TRY_AGAIN_LATER, 'Restoring a backup');
      return;
    }
    const ip = clientAddress(request.socket.remoteAddress, request.headers['x-forwarded-for']);
    const flush = coalesceWrites(socket);
    const hub = this.hub.connect(
      () => this.actors.resolve({ headers: request.headers, ip, url: '/ws' }),
      (message, text) => {
        if (socket.readyState !== socket.OPEN) return;
        flush();
        socket.send(text ?? JSON.stringify(message));
      },
      () => socket.close(POLICY_VIOLATION, 'Signed out'),
      { ip },
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

/**
 * Frames sent to one socket in the same turn of the event loop (an event and the presence flush,
 * a 200-line signature paste) leave in one write instead of one system call each: the TCP
 * socket is corked at the first frame and uncorked once the turn is over. Returns what to call
 * before each send.
 */
export function coalesceWrites(socket: WebSocket): () => void {
  // ws keeps its TCP socket as `_socket`; without one (a test double) frames go out one by one.
  const tcp = (socket as unknown as { _socket?: Pick<Socket, 'cork' | 'uncork'> })._socket;
  let corked = false;
  return () => {
    if (!tcp || corked) return;
    corked = true;
    tcp.cork();
    setImmediate(() => {
      corked = false;
      tcp.uncork();
    });
  };
}
