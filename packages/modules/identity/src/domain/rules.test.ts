import { describe, expect, it } from 'vitest';
import { chooseLanding, describeUserAgent, withRecentMap } from './rules.js';

const maps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('landing map', () => {
  it('goes account default, instance default, last opened, only map, first map', () => {
    const pick = (input: Partial<Parameters<typeof chooseLanding>[0]>) =>
      chooseLanding({ maps, accountDefault: null, instanceDefault: null, recent: [], ...input });
    expect(pick({ accountDefault: 'b', instanceDefault: 'c', recent: ['a'] })).toEqual({
      map: { id: 'b' },
      reason: 'account',
    });
    expect(pick({ accountDefault: 'gone', instanceDefault: 'c', recent: ['a'] })?.reason).toBe('instance');
    expect(pick({ instanceDefault: 'gone', recent: ['gone', 'a'] })).toEqual({
      map: { id: 'a' },
      reason: 'recent',
    });
    expect(pick({})).toEqual({ map: { id: 'a' }, reason: 'first' });
    expect(
      chooseLanding({ maps: [{ id: 'x' }], accountDefault: null, instanceDefault: null, recent: [] }),
    ).toEqual({
      map: { id: 'x' },
      reason: 'only',
    });
    expect(chooseLanding({ maps: [], accountDefault: 'a', instanceDefault: 'b', recent: ['c'] })).toBeNull();
  });

  it('keeps recent maps most recent first, unique and few', () => {
    expect(withRecentMap(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(withRecentMap(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
    expect(withRecentMap(undefined, 'a')).toEqual(['a']);
  });
});

describe('describeUserAgent', () => {
  it('names common browsers and devices', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toEqual({ browser: 'Edge', os: 'Windows', device: 'desktop' });
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toEqual({ browser: 'Firefox', os: 'Linux', device: 'desktop' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'Android', device: 'mobile' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iPad', device: 'tablet' });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null, device: 'unknown' });
  });
});
