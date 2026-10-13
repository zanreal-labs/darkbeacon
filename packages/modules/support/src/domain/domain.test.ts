import { describe, expect, it } from 'vitest';
import {
  characterOfDistinctId,
  identityOf,
  parseSurveyRef,
  resolveIdentity,
  supportDistinctId,
  surveyProperties,
  type SupportIdentityRecord,
} from './index.js';

const PILOT = 2112000001;

describe('support identities', () => {
  it('names the first owner eve:<id> and later owners eve:<id>:o<n>', () => {
    expect(supportDistinctId(PILOT, 1)).toBe(`eve:${PILOT}`);
    expect(supportDistinctId(PILOT, 2)).toBe(`eve:${PILOT}:o2`);
    expect(supportDistinctId(PILOT, 13)).toBe(`eve:${PILOT}:o13`);
    expect(() => supportDistinctId(0, 1)).toThrow();
    expect(() => supportDistinctId(PILOT, 0)).toThrow();
    expect(characterOfDistinctId(`eve:${PILOT}`)).toBe(PILOT);
    expect(characterOfDistinctId(`eve:${PILOT}:o2`)).toBe(PILOT);
    for (const bad of ['eve:', `eve:${PILOT}:o1`, `eve:${PILOT}:o0`, `x:${PILOT}`, `eve:${PILOT}:o2:x`])
      expect(characterOfDistinctId(bad), bad).toBeNull();
  });

  it('keeps one identity per owner: a sale starts a new one, a return finds the old one', () => {
    const known: SupportIdentityRecord[] = [];
    const sign = (ownerHash: string, name = 'Pilot One') => {
      const { record, isNew } = resolveIdentity(known, {
        characterId: PILOT,
        characterName: name,
        ownerHash,
      });
      if (isNew) known.push(record);
      else known[known.findIndex((r) => r.ownerHash === ownerHash)] = record;
      return { distinctId: identityOf(record).distinctId, isNew };
    };

    expect(sign('seller')).toEqual({ distinctId: `eve:${PILOT}`, isNew: true });
    expect(sign('seller')).toEqual({ distinctId: `eve:${PILOT}`, isNew: false });
    // Sold: the buyer never gets the seller's identity.
    expect(sign('buyer')).toEqual({ distinctId: `eve:${PILOT}:o2`, isNew: true });
    expect(sign('third')).toEqual({ distinctId: `eve:${PILOT}:o3`, isNew: true });
    // Back to the first owner: their own tickets again.
    expect(sign('seller', 'Renamed')).toEqual({ distinctId: `eve:${PILOT}`, isNew: false });
    expect(known.find((r) => r.ownerHash === 'seller')?.characterName).toBe('Renamed');
  });

  it('never mixes characters', () => {
    const other = { characterId: 2112000002, ownerHash: 'seller', generation: 4, characterName: 'Other' };
    const { record } = resolveIdentity([other], {
      characterId: PILOT,
      characterName: 'P',
      ownerHash: 'seller',
    });
    expect(record.generation).toBe(1);
  });
});

describe('surveys', () => {
  it('reads survey and question ids from the environment', () => {
    expect(parseSurveyRef(undefined, 'quick')).toBeNull();
    expect(parseSurveyRef(' ', 'feature')).toBeNull();
    expect(parseSurveyRef('0190-a:rate-1:text-2', 'quick')).toEqual({
      surveyId: '0190-a',
      ratingQuestionId: 'rate-1',
      textQuestionId: 'text-2',
    });
    expect(parseSurveyRef('0190-b:text-3', 'feature')).toEqual({
      surveyId: '0190-b',
      ratingQuestionId: null,
      textQuestionId: 'text-3',
    });
    expect(() => parseSurveyRef('only-one', 'quick')).toThrow(/rating question/);
    expect(() => parseSurveyRef('a:b c', 'feature')).toThrow();
  });

  it('builds a survey sent event with one response per question, as text', () => {
    const ref = { surveyId: 's1', ratingQuestionId: 'q-rate', textQuestionId: 'q-text' };
    expect(surveyProperties(ref, { rating: 4, text: 'Great mapper' }, 'sub-1')).toEqual({
      $survey_id: 's1',
      $survey_submission_id: 'sub-1',
      $survey_completed: true,
      '$survey_response_q-rate': '4',
      '$survey_response_q-text': 'Great mapper',
    });
    expect(surveyProperties(ref, { text: '' }, 'sub-2')).not.toHaveProperty('$survey_response_q-text');
  });
});
