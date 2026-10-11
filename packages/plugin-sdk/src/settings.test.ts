import { describe, expect, it } from 'vitest';
import { eventAllowed } from './manifest.js';
import { settingsValidator } from './settings.js';

describe('eventAllowed', () => {
  it('matches exact types, prefixes and the wildcard', () => {
    expect(eventAllowed(['system.added'], 'system.added')).toBe(true);
    expect(eventAllowed(['system.*'], 'system.removed')).toBe(true);
    expect(eventAllowed(['system.*'], 'system.*')).toBe(true);
    expect(eventAllowed(['*'], 'connection.added')).toBe(true);
    expect(eventAllowed(['system.added'], 'system.*')).toBe(false);
    expect(eventAllowed(['system.*'], '*')).toBe(false);
    expect(eventAllowed(['system.*'], 'signature.added')).toBe(false);
    expect(eventAllowed([], 'system.added')).toBe(false);
  });
});

describe('settingsValidator', () => {
  const validate = settingsValidator({
    type: 'object',
    properties: {
      webhookUrl: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string' }, default: ['system.added'] },
    },
    required: ['webhookUrl'],
    additionalProperties: false,
  });

  it('accepts valid settings and applies defaults', () => {
    expect(validate({ webhookUrl: 'https://example.com/hook' })).toEqual({
      ok: true,
      value: { webhookUrl: 'https://example.com/hook', events: ['system.added'] },
    });
  });

  it('reports every problem with its path', () => {
    const result = validate({ webhookUrl: 42, extra: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['webhookUrl']));
  });

  it('refuses schemas that are not objects', () => {
    expect(() => settingsValidator({ type: 'string' })).toThrow('type "object"');
  });
});
