import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/config.js';

try {
  const config = await loadConfig();
  const app = await createApp(config);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const logger = new Logger('Wormwright');
  for (const name of config.deprecated) logger.warn(`deprecated setting: ${name}`);
  if (config.demoMode) logger.warn('demo mode is on: every visitor is signed in as the demo account');
  logger.log(`listening on :${config.port} (${config.publicUrl})`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
