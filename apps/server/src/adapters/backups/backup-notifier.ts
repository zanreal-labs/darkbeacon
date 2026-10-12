import type { BackupAlert, BackupNotifier } from '@darkbeacon/backups';

const COLORS: Record<BackupAlert['kind'], number> = {
  completed: 0x3fb950,
  failed: 0xf85149,
  restored: 0x38c6d6,
};

function isDiscordWebhook(url: URL): boolean {
  return /(^|\.)discord(app)?\.com$/.test(url.hostname) && url.pathname.startsWith('/api/webhooks/');
}

/**
 * Tells admins about backups: through the core notifier (channels plugins provide; instance
 * notifications have no map) and, when one is set, the alert webhook: a Discord webhook gets an
 * embed, anything else a small JSON body. Successful backups only when asked for.
 */
export class HttpBackupNotifier implements BackupNotifier {
  constructor(
    private readonly deps: {
      /** The core notifier (`NotifierRegistry.send`), or nothing. */
      core?: (notification: { mapId: null; title: string; body: string }) => Promise<void>;
      fetch: (url: string, init?: RequestInit) => Promise<Response>;
      instanceUrl: string;
      onError: (error: unknown) => void;
    },
  ) {}

  async send(
    alert: BackupAlert,
    settings: { notifyUrl: string | null; notifySuccess: boolean },
  ): Promise<void> {
    if (alert.kind === 'completed' && !settings.notifySuccess) return;
    await Promise.all([
      this.deps.core?.({ mapId: null, title: alert.title, body: alert.body }).catch(this.deps.onError),
      settings.notifyUrl ? this.post(settings.notifyUrl, alert).catch(this.deps.onError) : undefined,
    ]);
  }

  private async post(address: string, alert: BackupAlert): Promise<void> {
    const url = new URL(address);
    const body = isDiscordWebhook(url)
      ? {
          username: 'Darkbeacon',
          embeds: [
            {
              title: alert.title,
              description: alert.body.slice(0, 4000),
              url: this.deps.instanceUrl,
              color: COLORS[alert.kind],
            },
          ],
        }
      : {
          event: `backup.${alert.kind}`,
          title: alert.title,
          body: alert.body,
          instance: this.deps.instanceUrl,
        };
    const response = await this.deps.fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Darkbeacon' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`alert webhook answered ${response.status}`);
  }
}
