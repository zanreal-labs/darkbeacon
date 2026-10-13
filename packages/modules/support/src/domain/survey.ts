import type { SupportFeedbackKind } from '@darkbeacon/shared';

/**
 * A PostHog survey in API mode (no popup): the hub sends the answers itself as a `survey sent`
 * event, one property per question, `$survey_response_<question id>`
 * (https://posthog.com/docs/surveys/implementing-custom-surveys).
 */
export interface SurveyRef {
  surveyId: string;
  /** Quick feedback only: the rating question (1-5). */
  ratingQuestionId: string | null;
  textQuestionId: string;
}

export type SurveysConfig = Record<SupportFeedbackKind, SurveyRef | null>;

const PART = /^[A-Za-z0-9-]{1,64}$/;

/**
 * `SUPPORT_SURVEY_QUICK=<survey id>:<rating question id>:<text question id>` and
 * `SUPPORT_SURVEY_FEATURE=<survey id>:<text question id>`. Null when unset; throws when malformed.
 */
export function parseSurveyRef(value: string | undefined, kind: SupportFeedbackKind): SurveyRef | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parts = raw.split(':');
  const expected = kind === 'quick' ? 3 : 2;
  if (parts.length !== expected || !parts.every((p) => PART.test(p))) {
    throw new Error(
      kind === 'quick'
        ? 'expected <survey id>:<rating question id>:<text question id>'
        : 'expected <survey id>:<text question id>',
    );
  }
  return kind === 'quick'
    ? { surveyId: parts[0]!, ratingQuestionId: parts[1]!, textQuestionId: parts[2]! }
    : { surveyId: parts[0]!, ratingQuestionId: null, textQuestionId: parts[1]! };
}

/** The properties of one `survey sent` event (answers are text, as PostHog expects). */
export function surveyProperties(
  ref: SurveyRef,
  answer: { rating?: number | undefined; text: string },
  submissionId: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    $survey_id: ref.surveyId,
    $survey_submission_id: submissionId,
    $survey_completed: true,
  };
  if (ref.ratingQuestionId && answer.rating !== undefined)
    properties[`$survey_response_${ref.ratingQuestionId}`] = String(answer.rating);
  if (answer.text) properties[`$survey_response_${ref.textQuestionId}`] = answer.text;
  return properties;
}
