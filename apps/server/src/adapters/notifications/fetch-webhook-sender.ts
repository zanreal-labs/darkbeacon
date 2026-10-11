import type { WebhookSender } from '@wormwright/notifications';

/** POSTs with the global fetch; a receiver gets 10 s to answer. Redirects are not followed. */
export class FetchWebhookSender implements WebhookSender {
  constructor(private readonly timeoutMs = 10_000) {}

  async post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }> {
    const response = await fetch(url, {
      method: 'POST',
      body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // The body is never shown to anyone; drain it so the connection can be reused.
    await response.body?.cancel();
    return { status: response.status };
  }
}
