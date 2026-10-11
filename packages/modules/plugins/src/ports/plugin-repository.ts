import type { InstalledPlugin } from '../domain/plugin.js';

export interface PluginRepository {
  list(): Promise<InstalledPlugin[]>;
  findById(id: string): Promise<InstalledPlugin | null>;
  upsert(plugin: InstalledPlugin): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Fetches and unpacks plugin packages (catalogue entry, npm name or .tgz) into the plugins directory. */
export interface PluginInstaller {
  install(source: string): Promise<{ id: string; manifest: unknown; directory: string }>;
  remove(id: string): Promise<void>;
}
