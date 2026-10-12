import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { coalesceWrites } from './realtime.gateway.js';

describe('coalesceWrites', () => {
  it('corks the TCP socket once per turn of the event loop and uncorks after it', async () => {
    const calls: string[] = [];
    const socket = { _socket: { cork: () => calls.push('cork'), uncork: () => calls.push('uncork') } };
    const flush = coalesceWrites(socket as unknown as WebSocket);
    flush();
    flush();
    flush();
    expect(calls).toEqual(['cork']);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(['cork', 'uncork']);
    flush();
    expect(calls).toEqual(['cork', 'uncork', 'cork']);
  });

  it('does nothing without a TCP socket', () => {
    expect(() => coalesceWrites({} as WebSocket)()).not.toThrow();
  });
});
