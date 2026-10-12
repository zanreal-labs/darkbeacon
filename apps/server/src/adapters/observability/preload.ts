// Preloaded with `node --import ./dist/adapters/observability/preload.js dist/main.js`, so
// telemetry (when the environment turns it on) starts before anything it instruments is loaded.
import { bootTelemetry } from './boot.js';

await bootTelemetry(process.env);
