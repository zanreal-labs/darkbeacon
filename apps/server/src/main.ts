import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/config.js';
import { telemetryRuntime, webTelemetryEnv } from './adapters/observability/runtime.js';
import { resolveWebServer } from './web/web-server.js';

try {
  const config = await loadConfig();
  // The web app's server runs next to the API on a loopback port; it reaches the API the same way.
  const telemetry = telemetryRuntime();
  const web = await resolveWebServer(
    process.env,
    `http://127.0.0.1:${config.port}`,
    new Logger('Web'),
    webTelemetryEnv(telemetry),
  );
  const app = await createApp(config, { web }).catch(async (error: unknown) => {
    await web?.stop();
    throw error;
  });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const logger = new Logger('Darkbeacon');
  for (const name of config.deprecated) logger.warn(`deprecated setting: ${name}`);
  if (config.demoMode) logger.warn('demo mode is on: every visitor is signed in as the demo account');
  if (telemetry.settings.enabled && !telemetry.running) {
    logger.warn(
      'OpenTelemetry is configured but not running: start node with --import ./apps/server/dist/adapters/observability/preload.js',
    );
  } else if (telemetry.running) {
    logger.log(`OpenTelemetry on as ${telemetry.settings.serviceName}`);
  }
  logger.log(`listening on :${config.port} (${config.publicUrl})`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
