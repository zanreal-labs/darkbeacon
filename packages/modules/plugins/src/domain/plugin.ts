/** A plugin installed into DATA_DIR/plugins. The manifest is validated with plugin-sdk. */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  /** Raw manifest JSON as installed. */
  manifest: unknown;
  enabled: boolean;
  /** Maps where the plugin is switched off although enabled on the instance. */
  disabledMapIds: string[];
  failureCount: number;
  error: string | null;
  installedAt: number;
}
