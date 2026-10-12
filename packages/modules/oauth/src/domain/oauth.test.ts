import { describe, expect, it } from 'vitest';
import {
  narrowToMaps,
  parseScopeParam,
  redirectAllowed,
  resourceMatches,
  validRedirectUri,
  withoutAdmin,
} from './oauth.js';

describe('OAuth rules', () => {
  it('accepts https, loopback http and app schemes as redirect URIs, nothing else', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(validRedirectUri('http://localhost/cb')).toBe(true);
    expect(validRedirectUri('com.example.app:/oauth')).toBe(true);
    for (const bad of [
      'http://evil.example/cb',
      'https://x.example/cb#frag',
      'https://u:p@x.example/',
      'javascript:alert(1)',
      'data:text/html,x',
      'nonsense',
    ]) {
      expect(validRedirectUri(bad), bad).toBe(false);
    }
  });

  it('matches redirect URIs exactly, except the port of loopback ones', () => {
    const registered = ['https://app.example/cb', 'http://127.0.0.1/callback'];
    expect(redirectAllowed(registered, 'https://app.example/cb')).toBe(true);
    expect(redirectAllowed(registered, 'https://app.example/cb2')).toBe(false);
    expect(redirectAllowed(registered, 'https://app.example/cb?x=1')).toBe(false);
    expect(redirectAllowed(registered, 'http://127.0.0.1:51234/callback')).toBe(true);
    expect(redirectAllowed(registered, 'http://127.0.0.1:51234/other')).toBe(false);
    expect(redirectAllowed(registered, 'http://localhost:51234/callback')).toBe(false);
  });

  it('parses scopes, refuses unknown ones and never grants administration', () => {
    expect(parseScopeParam('maps:read  signatures:write maps:read offline_access')).toEqual({
      scopes: ['maps:read', 'signatures:write'],
      invalid: [],
    });
    expect(parseScopeParam('maps:read root federation:*').invalid).toEqual(['root', 'federation:*']);
    expect(withoutAdmin(['admin:*', 'maps:read'])).toEqual(['maps:read']);
  });

  it('narrows scopes to the picked maps', () => {
    expect(
      narrowToMaps(['*:read', 'signatures:write', 'universe:read', 'map:m3:maps:read'], ['m1', 'm2']),
    ).toEqual([
      'map:m1:*:read',
      'map:m2:*:read',
      'map:m1:signatures:write',
      'map:m2:signatures:write',
      'universe:read',
    ]);
    expect(narrowToMaps(['maps:read'], null)).toEqual(['maps:read']);
  });

  it('binds tokens to the MCP endpoint of this instance', () => {
    expect(resourceMatches(undefined, 'https://map.example')).toBe(true);
    expect(resourceMatches('https://map.example/mcp', 'https://map.example')).toBe(true);
    expect(resourceMatches('https://MAP.example/mcp/', 'https://map.example')).toBe(true);
    expect(resourceMatches('https://map.example', 'https://map.example')).toBe(true);
    expect(resourceMatches('https://other.example/mcp', 'https://map.example')).toBe(false);
    expect(resourceMatches('https://map.example/api', 'https://map.example')).toBe(false);
  });
});
