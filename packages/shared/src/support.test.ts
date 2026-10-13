import { describe, expect, it } from 'vitest';
import {
  CreateSupportTicketRequest,
  decodeSupportContext,
  encodeSupportContext,
  flattenSupportContext,
  isSupportOrigin,
  readSupportMessage,
  sanitizeSupportContext,
  scrubClientError,
  SUPPORT_MESSAGE_SOURCE,
  SupportFeedbackRequest,
  supportContextLines,
  withoutContextLine,
  type SupportContext,
} from './support.js';

describe('support context', () => {
  it('scrubs URLs, map addresses, quoted strings and long numbers out of error lines', () => {
    expect(
      scrubClientError(
        `TypeError: cannot read 'name' of undefined at https://map.corp.example/m/home-chain?x=1 (system 31000005, char 2112000001)`,
      ),
    ).toBe('TypeError: cannot read <str> of undefined at <url> (system <n>, char <n>)');
    expect(scrubClientError('Failed to fetch /api/maps/abc on /m/secret-chain and /p/tok3n')).toBe(
      'Failed to fetch /api/maps/abc on /m/<slug> and /p/<slug>',
    );
    expect(scrubClientError('He said "J123456 is our home" and `notes`')).toBe('He said <str> and <str>');
    // Short numbers (line numbers, counts) stay; seven digits and more do not.
    expect(scrubClientError('line 42 col 7 id 1234567')).toBe('line 42 col 7 id <n>');
    expect(scrubClientError('GET /api/maps/0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11 failed')).toBe(
      'GET /api/maps/<id> failed',
    );
    expect(scrubClientError('x'.repeat(5000))).toHaveLength(300);
  });

  it('keeps only known, valid fields from an untrusted opener', () => {
    const raw = {
      appVersion: '0.1.0',
      commit: 'abcdef1',
      db: 'postgres',
      page: 'map',
      section: 'audit',
      viewport: 'desktop',
      browser: 'firefox',
      os: 'linux',
      locale: 'en-GB',
      theme: 'dark',
      scheme: 'dark',
      demo: false,
      errors: ['1', '2', '3', '4', '5', `boom at "J100101" https://x.test`],
      // not allowed or not valid
      slug: 'home-chain',
      instanceId: 'x',
      email: 'a@b.c',
      mapCounts: { systems: 3, connections: 2, signatures: 'many' },
      instanceHost: 'Not A Host!',
      login: 'password',
    };
    const context = sanitizeSupportContext(raw);
    expect(Object.keys(context).sort()).toEqual(
      [
        'appVersion',
        'browser',
        'commit',
        'db',
        'demo',
        'errors',
        'locale',
        'os',
        'page',
        'scheme',
        'section',
        'theme',
        'viewport',
      ].sort(),
    );
    expect(context.errors).toEqual(['2', '3', '4', '5', 'boom at <str> <url>']);
    expect(sanitizeSupportContext('nope')).toEqual({});
    expect(sanitizeSupportContext([1])).toEqual({});
    // The request schema refuses unknown fields outright.
    expect(
      CreateSupportTicketRequest.safeParse({ category: 'bug', message: 'x', context: { slug: 'a' } }).success,
    ).toBe(false);
  });

  it('shows the context as removable lines', () => {
    const context: SupportContext = {
      appVersion: '0.1.0',
      demo: true,
      errors: ['a', 'b'],
      mapCounts: { systems: 4, connections: 3, signatures: 12 },
      instanceHost: 'map.example.com',
    };
    const lines = supportContextLines(context);
    expect(lines.map((l) => [l.id, l.value])).toEqual([
      ['appVersion', '0.1.0'],
      ['demo', 'Yes'],
      ['errors.0', 'a'],
      ['errors.1', 'b'],
      ['instanceHost', 'map.example.com'],
      ['mapCounts', '4 systems, 3 connections, 12 signatures'],
    ]);
    let next = withoutContextLine(context, 'errors.0');
    expect(next.errors).toEqual(['b']);
    next = withoutContextLine(next, 'errors.0');
    expect(next).not.toHaveProperty('errors');
    expect(withoutContextLine(context, 'instanceHost')).not.toHaveProperty('instanceHost');
  });

  it('flattens for PostHog: at most 20 string values', () => {
    const flat = flattenSupportContext({
      appVersion: '0.1.0',
      instanceHost: 'map.example.com',
      errors: ['a', 'b'],
      demo: false,
    });
    expect(flat).toEqual({
      app_version: '0.1.0',
      demo: 'No',
      instance_host: 'map.example.com',
      errors: 'a\nb',
    });
    expect(Object.values(flat).every((v) => typeof v === 'string' && v.length <= 2000)).toBe(true);
  });

  it('round-trips the ?ctx= fallback and ignores garbage', () => {
    const context: SupportContext = { appVersion: '0.1.0', page: 'jump', locale: 'pl-PL' };
    expect(decodeSupportContext(encodeSupportContext(context))).toEqual(context);
    expect(decodeSupportContext('!!!')).toEqual({});
    expect(decodeSupportContext(null)).toEqual({});
    expect(decodeSupportContext('a'.repeat(5000))).toEqual({});
  });

  it('needs something in feedback', () => {
    expect(SupportFeedbackRequest.safeParse({ kind: 'quick', rating: 4 }).success).toBe(true);
    expect(SupportFeedbackRequest.safeParse({ kind: 'quick' }).success).toBe(false);
    expect(SupportFeedbackRequest.safeParse({ kind: 'feature', rating: 4 }).success).toBe(false);
    expect(SupportFeedbackRequest.safeParse({ kind: 'feature', text: 'More hotkeys' }).success).toBe(true);
  });
});

describe('support windows', () => {
  it('accepts https origins, and http only on loopback names', () => {
    for (const ok of [
      'https://map.example.com',
      'https://a.b:8443',
      'http://localhost:3000',
      'http://127.0.0.1:4',
      'http://dbk.localhost',
    ])
      expect(isSupportOrigin(ok), ok).toBe(true);
    for (const bad of [
      'http://map.example.com',
      'https://map.example.com/',
      'https://map.example.com/path',
      'https://user@map.example.com',
      'javascript:alert(1)',
      'null',
      '',
      42,
    ])
      expect(isSupportOrigin(bad), String(bad)).toBe(false);
  });

  it('reads only our messages from the expected origin', () => {
    const ready = { source: SUPPORT_MESSAGE_SOURCE, type: 'ready' };
    expect(readSupportMessage({ origin: 'https://hub.example', data: ready }, 'https://hub.example')).toEqual(
      ready,
    );
    expect(
      readSupportMessage({ origin: 'https://evil.example', data: ready }, 'https://hub.example'),
    ).toBeNull();
    expect(
      readSupportMessage({ origin: 'https://hub.example.evil', data: ready }, 'https://hub.example'),
    ).toBeNull();
    expect(
      readSupportMessage({ origin: 'https://hub.example', data: { type: 'ready' } }, 'https://hub.example'),
    ).toBeNull();
    expect(
      readSupportMessage(
        { origin: 'https://hub.example', data: { source: SUPPORT_MESSAGE_SOURCE, type: 'steal' } },
        'https://hub.example',
      ),
    ).toBeNull();
  });
});
