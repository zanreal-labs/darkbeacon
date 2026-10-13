import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeWanderer } from '../../test-support/fake-wanderer.js';

/**
 * The fake Wanderer (tools/fake-wanderer) answers like the real one: every route the importer
 * reads, compared with the answers recorded from a running instance of our fork
 * (tools/fake-wanderer/recorded/answers.json): the same status, the same fields at every level
 * and the same kinds of values. A change in Wanderer is recorded again and fails here first.
 */
interface Recorded {
  path: string;
  status: number;
  body: unknown;
}

const recorded = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../../tools/fake-wanderer/recorded/answers.json'), 'utf8'),
) as Record<string, Recorded>;

/** Fields present on some rows only, by what the row holds (an ACL member has one kind of id). */
const CONDITIONAL = new Set(['data.members[].eve_character_id', 'data.members[].eve_corporation_id', 'data.members[].eve_alliance_id']);

/** `path` -> the kinds of value seen there (`object`, `array`, `string`, `number`, `boolean`, `null`). */
function shape(value: unknown, path = '', out = new Map<string, Set<string>>()): Map<string, Set<string>> {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  let kinds = out.get(path);
  if (!kinds) out.set(path, (kinds = new Set()));
  kinds.add(kind);
  if (Array.isArray(value)) for (const item of value) shape(item, `${path}[]`, out);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) shape(item, path ? `${path}.${key}` : key, out);
  return out;
}

describe('the fake Wanderer answers like the recorded one', () => {
  let fake: Awaited<ReturnType<typeof startFakeWanderer>>;
  let fakeOff: Awaited<ReturnType<typeof startFakeWanderer>>;
  beforeAll(async () => {
    fake = await startFakeWanderer();
    fakeOff = await startFakeWanderer({ webhooks: false });
  });
  afterAll(async () => {
    await fake.close();
    await fakeOff.close();
  });

  const officers = () => fake.map.acls.find((a) => a.key)!;
  const hiddenId = () => fake.map.systems.find((s) => !s.visible)!.solar_system_id;
  const ask = async (name: string, answer: Recorded) => {
    let path = answer.path
      .replaceAll('import-probe', fake.map.map.slug)
      .replace('/systems/31000005', `/systems/${hiddenId()}`);
    let key = fake.map.apiKey;
    if (name.startsWith('GET /api/acls/:id')) {
      path = `/api/acls/${officers().id}`;
      if (name.includes('ACL key')) key = officers().key!;
    }
    if (name.includes('wrong key')) key = 'wrong';
    const base = name.includes('webhooks switched off') ? fakeOff.url : fake.url;
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${key}` } });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain text, as Wanderer's plugs answer refusals
    }
    return { status: res.status, body };
  };

  for (const [name, answer] of Object.entries(recorded)) {
    // Showing one system by id is not a route the importer reads.
    if (name.includes(':solar_system_id')) continue;
    it(name, async () => {
      const got = await ask(name, answer);
      expect(got.status).toBe(answer.status);
      if (typeof answer.body === 'string') {
        expect(got.body).toBe(answer.body);
        return;
      }
      const real = shape(answer.body);
      const ours = shape(got.body);
      // Nothing the real one lacks ...
      expect([...ours.keys()].filter((p) => !real.has(p)).sort()).toEqual([]);
      // ... and nothing it has missing, unless our data has no row there (an empty list).
      const emptyHere = (p: string) =>
        [...ours.keys()].some((o) => p.startsWith(`${o}[]`) && !ours.has(`${o}[]`));
      expect([...real.keys()].filter((p) => !ours.has(p) && !CONDITIONAL.has(p) && !emptyHere(p)).sort()).toEqual(
        [],
      );
      // The same kinds of values where both have one (null stands for any).
      const mismatched: string[] = [];
      for (const [path, kinds] of ours) {
        const theirs = [...(real.get(path) ?? [])].filter((k) => k !== 'null');
        const mine = [...kinds].filter((k) => k !== 'null');
        if (theirs.length > 0 && mine.some((k) => !theirs.includes(k))) mismatched.push(`${path}: ${mine} vs ${theirs}`);
      }
      expect(mismatched).toEqual([]);
    });
  }
});
