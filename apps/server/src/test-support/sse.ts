import { expect, vi } from 'vitest';

export interface SseFrame {
  event: string | null;
  id: string | null;
  data: unknown;
  /** Comment lines (`: keepalive`). */
  comment: string | null;
}

/** Reads a `text/event-stream` response frame by frame, for tests. */
export class SseReader {
  readonly frames: SseFrame[] = [];
  private buffer = '';
  private readonly done: Promise<void>;
  private readonly abort = new AbortController();
  readonly response: Promise<Response>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.response = fetch(url, { headers, signal: this.abort.signal });
    this.done = this.response.then(async (response) => {
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          this.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // aborted
      }
    });
  }

  private push(text: string): void {
    this.buffer += text;
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const frame: SseFrame = { event: null, id: null, data: null, comment: null };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) frame.comment = line.slice(1).trim();
        else if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('id: ')) frame.id = line.slice(4);
        else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6)) as unknown;
      }
      this.frames.push(frame);
    }
  }

  /** Waits until a frame matches. */
  async waitFor(match: (frame: SseFrame) => boolean, timeout = 5000): Promise<SseFrame> {
    await vi.waitFor(() => expect(this.frames.some(match)).toBe(true), { timeout, interval: 20 });
    return this.frames.find(match)!;
  }

  events(name: string): SseFrame[] {
    return this.frames.filter((f) => f.event === name);
  }

  async close(): Promise<void> {
    this.abort.abort();
    await this.done.catch(() => undefined);
  }
}
