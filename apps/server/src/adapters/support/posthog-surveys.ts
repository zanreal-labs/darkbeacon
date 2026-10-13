import { RateLimitedError } from '@darkbeacon/core';
import {
  surveyProperties,
  type FeedbackSink,
  type FeedbackSubmission,
  type SurveysConfig,
} from '@darkbeacon/support';
import { SupportUnavailable } from './posthog-support-desk.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Feedback as answers to API-mode surveys in the support project: one `survey sent` event per
 * submission, sent from the hub's server with the project key (`SUPPORT_SURVEYS_KEY`), so no
 * PostHog script runs in a browser. Anonymous answers make no person profile and carry no IP or
 * GeoIP; signed-in ones carry the support identity and the character's name.
 */
export class PostHogSurveys implements FeedbackSink {
  constructor(
    private readonly options: {
      host: string;
      projectKey: string;
      surveys: SurveysConfig;
      fetch: Fetch;
      userAgent: string;
    },
  ) {}

  async send(submission: FeedbackSubmission): Promise<void> {
    const survey = this.options.surveys[submission.kind];
    if (!survey) throw new SupportUnavailable('This kind of feedback is not set up on the hub');
    const anonymous = submission.identity === null;
    const properties: Record<string, unknown> = {
      ...surveyProperties(
        survey,
        { rating: submission.rating ?? undefined, text: submission.text },
        submission.id,
      ),
      ...(submission.context.appVersion ? { app_version: submission.context.appVersion } : {}),
      ...(submission.context.page ? { page: submission.context.page } : {}),
      ...(submission.context.viewport ? { viewport: submission.context.viewport } : {}),
      $lib: 'darkbeacon-hub',
      $geoip_disable: true,
      $ip: null,
      ...(anonymous
        ? { $process_person_profile: false }
        : { $set: { name: submission.identity!.characterName } }),
    };
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.host.replace(/\/+$/, '')}/i/v0/e/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': this.options.userAgent },
        body: JSON.stringify({
          api_key: this.options.projectKey,
          event: 'survey sent',
          // Anonymous: a fresh id per answer, so answers cannot be linked to each other.
          distinct_id: submission.identity?.distinctId ?? submission.id,
          uuid: submission.id,
          timestamp: new Date(submission.at).toISOString(),
          properties,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SupportUnavailable();
    }
    void response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new RateLimitedError('Feedback is busy; try again in a minute');
    if (!response.ok) throw new SupportUnavailable();
  }
}
