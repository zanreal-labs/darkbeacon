import type { OnApplicationShutdown } from '@nestjs/common';

/** Stops the web server child process with the application. */
export class WebLifecycle implements OnApplicationShutdown {
  constructor(private readonly web: { stop?(): Promise<void> } | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.web?.stop?.();
  }
}
