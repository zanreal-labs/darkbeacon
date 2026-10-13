import { expect, it } from 'vitest';
import { DEFAULT_TAGS, up, withDefaultTags } from '../migrations/mapping/0600_default_tags.js';
import { describeEachDialect } from './testing.js';

interface Tables {
  maps: {
    id: string;
    slug: string;
    name: string;
    owner_account_id: string;
    settings: string;
    labels: string;
    created_at: number;
    updated_at: number;
  };
}

type Tag = { id: string; name: string; color: string; description: string };

const NAMES = ['Staging', 'Sites', 'Hostile', 'Exit', 'Home', 'Farm', 'Fleet'];

describeEachDialect('migration mapping/0600_default_tags', (t) => {
  const insert = (id: string, labels: string) =>
    t.db
      .db<Tables>()
      .insertInto('maps')
      .values({
        id,
        slug: id,
        name: id,
        owner_account_id: 'alice',
        settings: '{"scopes":["wormhole"]}',
        labels,
        created_at: 1,
        updated_at: 1,
      })
      .execute();
  const tagsOf = async (id: string) => {
    const row = await t.db
      .db<Tables>()
      .selectFrom('maps')
      .select(['labels', 'updated_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(Number(row.updated_at)).toBe(1);
    return JSON.parse(row.labels) as Tag[];
  };

  it('adds the default Tags a map lacks by name, keeping the ones it has as they are', async () => {
    const own: Tag[] = [
      { id: 'u1', name: 'STAGING', color: '#ff0000', description: 'Ours' },
      { id: 'u2', name: 'Rolled', color: '#00ff00', description: '' },
      // A Tag of another name that happens to use a default's id.
      { id: 'home', name: 'Base', color: '#0000ff', description: '' },
    ];
    await insert('empty', '[]');
    await insert('own', JSON.stringify(own));
    await insert('full', JSON.stringify(DEFAULT_TAGS));
    await insert('broken', 'not json');

    await up(t.db.db());

    // An empty map gets all seven, in order, with their fixed ids.
    expect(await tagsOf('empty')).toEqual(DEFAULT_TAGS);
    // Existing Tags stay first and untouched; Staging is not doubled; a taken id gets a new one.
    const tags = await tagsOf('own');
    expect(tags.slice(0, 3)).toEqual(own);
    expect(tags.map((l) => l.name)).toEqual([
      'STAGING',
      'Rolled',
      'Base',
      ...NAMES.filter((n) => n !== 'Staging'),
    ]);
    const home = tags.find((l) => l.name === 'Home')!;
    expect(home.id).not.toBe('home');
    expect(new Set(tags.map((l) => l.id)).size).toBe(tags.length);
    // Complete and unreadable lists are left alone.
    expect(await tagsOf('full')).toEqual(DEFAULT_TAGS);
    const broken = await t.db
      .db<Tables>()
      .selectFrom('maps')
      .select('labels')
      .where('id', '=', 'broken')
      .executeTakeFirstOrThrow();
    expect(broken.labels).toBe('not json');

    // Running it again changes nothing.
    await up(t.db.db());
    expect(await tagsOf('own')).toEqual(tags);
    expect(await tagsOf('empty')).toEqual(DEFAULT_TAGS);
  });
});

it('ships the seven default Tags with descriptions and muted #rrggbb colours', () => {
  expect(DEFAULT_TAGS.map((l) => l.name)).toEqual(NAMES);
  for (const tag of DEFAULT_TAGS) {
    expect(tag.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(tag.description.length).toBeGreaterThan(0);
  }
});

it('stops at 64 Tags and reports nothing to do for a complete list', () => {
  const many = Array.from({ length: 62 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, color: '#000000' }));
  expect(
    withDefaultTags(many)!
      .map((l) => l.name)
      .slice(62),
  ).toEqual(['Staging', 'Sites']);
  expect(withDefaultTags([...DEFAULT_TAGS].reverse())).toBeNull();
});
