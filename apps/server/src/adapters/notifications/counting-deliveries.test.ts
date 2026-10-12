import { describe, expect, it } from 'vitest';
import { countingDeliveries } from './http-webhook-sender.js';

describe('countingDeliveries', () => {
  it('reports 2xx answers as delivered, other answers and failures as not', async () => {
    const outcomes: boolean[] = [];
    const answers = [204, 500];
    const sender = countingDeliveries(
      {
        post: async (url) => {
          if (url.includes('down')) throw new Error('ECONNREFUSED');
          return { status: answers.shift()! };
        },
      },
      (ok) => outcomes.push(ok),
    );
    expect(await sender.post('https://hooks.example/a', '{}', {})).toEqual({ status: 204 });
    expect(await sender.post('https://hooks.example/a', '{}', {})).toEqual({ status: 500 });
    await expect(sender.post('https://down.example/a', '{}', {})).rejects.toThrow('ECONNREFUSED');
    expect(outcomes).toEqual([true, false, false]);
  });
});
