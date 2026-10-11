import type { IncomingMessage } from 'node:http';
import { Inject, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { ActorResolverRegistry } from '../platform/actor.js';
import { RealtimeHub, type HubConnection } from './realtime.hub.js';

const HEARTBEAT_MS = 30_000;

/** The `/ws` transport: one hub connection per socket, plus ping/pong liveness checks. */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly sockets = new Map<WebSocket, { hub: HubConnection; alive: boolean }>();
  private readonly heartbeat = setInterval(() => this.checkLiveness(), HEARTBEAT_MS).unref();

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
  ) {}

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const hub = this.hub.connect(
      () => this.actors.resolve({ headers: request.headers }),
      (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
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
