/** `BackupModuleConfig`: the backup settings from the environment. */
export const BACKUP_CONFIG = 'BackupConfig';

export interface BackupModuleConfig {
  dir: string;
  scratchDir: string;
  maxUploadBytes: number;
}
