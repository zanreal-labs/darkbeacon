import type { InstanceSettings } from '../domain/instance-settings.js';

/** Instance settings stored in the database; missing keys fall back to the defaults. */
export interface InstanceSettingsRepository {
  load(): Promise<Partial<InstanceSettings>>;
  save(settings: Partial<InstanceSettings>): Promise<void>;
}
