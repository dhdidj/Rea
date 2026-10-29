import { chmodSync, existsSync, writeFileSync } from "node:fs";

export const writeAmpRegistrationBackup = (
  backupPath: string,
  settingsText: string,
): void => {
  // Backups can contain environment credentials. Restrict both new and
  // pre-existing backups before copying the settings.
  if (existsSync(backupPath)) chmodSync(backupPath, 0o600);
  writeFileSync(backupPath, settingsText, { mode: 0o600 });
};
