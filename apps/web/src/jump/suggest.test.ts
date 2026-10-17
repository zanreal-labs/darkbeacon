import { describe, expect, it } from 'vitest';
import { endpointsReducer, type Endpoints } from './endpoints';
import { UNIVERSE } from './fixtures.test-support';
import { buildStarModel } from './model';
import { pushRecent, rankSystems, suggestionsFor, whyLabel, type SuggestionSources } from './suggest';

const model = buildStarModel(UNIVERSE);
// Jita 0, Ignoitton 1, Ahbazon 2, Ami 3.
const JITA = 0;
const IGNOITTON = 1;
const AHBAZON = 2;
const AMI = 3;

const sources: SuggestionSources = {
  characters: [
    { system: AMI, name: 'Offline Alt', online: false },
    { system: IGNOITTON, name: 'Main', online: true },
  ],
  exits: [AHBAZON],
  mapSystems: [AHBAZON, JITA],
  recent: [AMI, JITA],
};

describe('suggestions', () => {
  it('offers a start where my characters are (online first), then exits, then recent picks', () => {
    const start = suggestionsFor('origin', sources);
    expect(start.map((s) => [model.names[s.index], s.why.kind])).toEqual([
      ['Ignoitton', 'character'],
      ['Ahbazon', 'exit'],
      ['Ami', 'character'],
      ['Jita', 'recent'],
    ]);
  });

  it('names the character in a start that is also an exit, where the exit was', () => {
    const start = suggestionsFor('origin', {
      ...sources,
      characters: [{ system: AHBAZON, name: 'Scout', online: false }],
    });
    expect(start[0]).toEqual({ index: AHBAZON, why: { kind: 'character', names: ['Scout'], online: false } });
    // For a destination the map says more: the exit stays an exit.
    const destination = suggestionsFor('destination', {
      ...sources,
      characters: [{ system: AHBAZON, name: 'Scout', online: false }],
    });
    expect(destination[0]).toEqual({ index: AHBAZON, why: { kind: 'exit' } });
  });

  it('offers a destination from the map first: exits, the map systems, then characters', () => {
    const destination = suggestionsFor('destination', sources);
    expect(destination.map((s) => [model.names[s.index], s.why.kind])).toEqual([
      ['Ahbazon', 'exit'],
      ['Jita', 'map'],
      ['Ignoitton', 'character'],
      ['Ami', 'character'],
    ]);
  });

  it('leaves out the other end of the route', () => {
    expect(suggestionsFor('destination', sources, AHBAZON).map((s) => s.index)).not.toContain(AHBAZON);
    expect(suggestionsFor('origin', sources, IGNOITTON)[0]!.index).toBe(AHBAZON);
  });

  it('groups characters in one system, online when any of them is', () => {
    const [first] = suggestionsFor('origin', {
      characters: [
        { system: AMI, name: 'Alt', online: false },
        { system: AMI, name: 'Main', online: true },
      ],
      exits: [],
      mapSystems: [],
      recent: [],
    });
    expect(first).toEqual({ index: AMI, why: { kind: 'character', names: ['Alt', 'Main'], online: true } });
    expect(whyLabel(first!.why)).toBe('Alt +1');
  });

  it('is nothing at all without a map, characters or history', () => {
    expect(suggestionsFor('origin', { characters: [], exits: [], mapSystems: [], recent: [] })).toEqual([]);
  });
});

describe('ranking', () => {
  const destination = suggestionsFor('destination', sources);

  it('lists the suggestions before anything is typed', () => {
    expect(rankSystems(model, '  ', destination).map((r) => r.index)).toEqual([
      AHBAZON,
      JITA,
      IGNOITTON,
      AMI,
    ]);
  });

  it('ranks matching suggestions first, then the rest of known space by name', () => {
    // "i": Ignoitton and Jita are suggestions (Ignoitton a prefix match); Ami is one too.
    const ranked = rankSystems(model, 'i', destination);
    expect(ranked.map((r) => model.names[r.index])).toEqual(['Ignoitton', 'Jita', 'Ami']);
    expect(ranked.every((r) => r.why !== null)).toBe(true);
  });

  it('fills up with plain search results, without repeating a suggestion', () => {
    const ranked = rankSystems(model, 'a', [{ index: AMI, why: { kind: 'exit' } }]);
    expect(ranked.map((r) => [model.names[r.index], r.why?.kind ?? null])).toEqual([
      ['Ami', 'exit'],
      ['Ahbazon', null],
      ['Jita', null],
    ]);
  });

  it('keeps to the limit', () => {
    expect(rankSystems(model, 'a', [], 2)).toHaveLength(2);
  });
});

describe('recent picks', () => {
  it('puts the latest first, once, and keeps a few', () => {
    expect(pushRecent(['Jita', 'Ami'], 'ami')).toEqual(['ami', 'Jita']);
    expect(pushRecent(['A', 'B', 'C'], 'D', 3)).toEqual(['D', 'A', 'B']);
  });
});

describe('start and destination', () => {
  const both: Endpoints = { origin: JITA, destination: AMI };

  it('swaps in one step', () => {
    expect(endpointsReducer(both, { type: 'swap' })).toEqual({ origin: AMI, destination: JITA });
    expect(endpointsReducer({ origin: JITA, destination: null }, { type: 'swap' })).toEqual({
      origin: null,
      destination: JITA,
    });
  });

  it('swapping twice is where it started', () => {
    const twice = endpointsReducer(endpointsReducer(both, { type: 'swap' }), { type: 'swap' });
    expect(twice).toEqual(both);
  });

  it('keeps the same state when nothing changes (no re-render)', () => {
    const empty: Endpoints = { origin: null, destination: null };
    expect(endpointsReducer(empty, { type: 'swap' })).toBe(empty);
    expect(endpointsReducer(empty, { type: 'clear' })).toBe(empty);
    expect(endpointsReducer(both, { type: 'origin', system: JITA })).toBe(both);
  });

  it('a system picked for one end that is the other end empties the other end', () => {
    expect(endpointsReducer(both, { type: 'origin', system: AMI })).toEqual({
      origin: AMI,
      destination: null,
    });
    expect(endpointsReducer(both, { type: 'destination', system: JITA })).toEqual({
      origin: null,
      destination: JITA,
    });
  });

  it('clears both', () => {
    expect(endpointsReducer(both, { type: 'clear' })).toEqual({ origin: null, destination: null });
  });
});
