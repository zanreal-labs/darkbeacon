import { HttpException, Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import type { ServerMessage } from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MaintenanceMode } from '../platform/maintenance.js';
import { RealtimeHub } from './realtime.hub.js';

/** Open event streams per client address and per principal (account or key), as Wanderer caps them. */
export const SSE_LIMITS = { perAddress: 20, perPrincipal: 10, keepaliveMs: 25_000 } as const;

export interface SseOpenOptions {
  request: FastifyRequest;
  reply: FastifyReply;
  /** The stream to follow (`map:<id>`); the caller has checked the actor may follow it. */
  stream: string;
  /** Resolves the actor again for the hub's re-checks (a revoked key or a logout ends the stream). */
  resolveActor: () => Promise<Actor | null>;
  actor: Actor | null;
  ip: string | null;
  /** Replay after this seq; undefined: a snapshot first. */
  sinceSeq: number | undefined;
  /** A hub message as SSE frames (null: nothing for this client). */
  frame(message: ServerMessage): string | null;
  /** Written once before anything else (Wanderer's `connected`). */
  preamble?: string;
  /** Headers besides the SSE ones (Wanderer's open CORS). */
  headers?: Record<string, string>;
  /** The comment sent while idle; `: keepalive` by default. */
  keepalive?: string;
}

class TooManyStreams extends HttpException {
  constructor(message: string) {
    super(message, 429);
  }
}

/**
 * Server-Sent Events over the realtime hub: the same subscription a WebSocket makes (authorized,
 * replayed from the durable log, re-checked after access changes), written as `text/event-stream`.
 * Used by the native `/api/streams/:stream/sse` and by the Wanderer-compatible stream.
 */
@Injectable()
export class SseStreams implements OnModuleInit, OnModuleDestroy {
  private readonly open = new Set<() => void>();
  private readonly counts = new Map<string, number>();

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
  ) {}

  onModuleInit(): void {
    // After a restore the seqs a client holds belong to the old database: streams start over.
    this.maintenance.register({
      name: 'sse',
      resume: (restored) => {
        if (restored) this.closeAll();
      },
    });
  }

  onModuleDestroy(): void {
    this.closeAll();
  }

  /** Open streams (for tests and metrics). */
  get size(): number {
    return this.open.size;
  }

  closeAll(): void {
    for (const close of [...this.open]) close();
  }

  /** Starts streaming; answers 429 (before any byte) when the client has too many streams open. */
  start(options: SseOpenOptions): void {
    if (this.maintenance.active) throw new HttpException('Restoring a backup; try again shortly', 503);
    const keys = [
      `ip:${options.ip ?? 'unknown'}`,
      ...(options.actor && 'id' in options.actor ? [`who:${options.actor.kind}:${options.actor.id}`] : []),
    ];
    const limits = [SSE_LIMITS.perAddress, SSE_LIMITS.perPrincipal];
    keys.forEach((key, i) => {
      if ((this.counts.get(key) ?? 0) >= limits[i]!)
        throw new TooManyStreams('Too many event streams open; close one first');
    });
    for (const key of keys) this.counts.set(key, (this.counts.get(key) ?? 0) + 1);

    const { reply } = options;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies (nginx) must not buffer the stream.
      'x-accel-buffering': 'no',
      ...options.headers,
    });
    let closed = false;
    let lastWrite = Date.now();
    const write = (chunk: string) => {
      if (closed) return;
      lastWrite = Date.now();
      raw.write(chunk);
    };
    if (options.preamble) write(options.preamble);

    const connection = this.hub.connect(
      options.resolveActor,
      (message) => {
        const chunk = options.frame(message);
        if (chunk) write(chunk);
        // A stream the client may no longer follow ends after telling it why.
        if (message.op === 'error' && message.stream === options.stream) close();
      },
      () => close(),
      { ip: options.ip },
    );
    const timer = setInterval(() => {
      if (Date.now() - lastWrite >= SSE_LIMITS.keepaliveMs - 50)
        write(`${options.keepalive ?? ': keepalive'}\n\n`);
    }, SSE_LIMITS.keepaliveMs).unref();

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      connection.close();
      this.open.delete(close);
      for (const key of keys) {
        const left = (this.counts.get(key) ?? 1) - 1;
        if (left <= 0) this.counts.delete(key);
        else this.counts.set(key, left);
      }
      raw.end();
    };
    this.open.add(close);
    options.request.raw.on('close', close);
    connection.receive(
      JSON.stringify({
        op: 'subscribe',
        stream: options.stream,
        ...(options.sinceSeq === undefined ? {} : { sinceSeq: options.sinceSeq }),
      }),
    );
  }
}

/** One SSE frame. `data` is one line of JSON. */
export function sseFrame(event: string, data: unknown, id?: string | number): string {
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
