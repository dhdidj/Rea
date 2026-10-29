import { chmodSync, lstatSync } from "node:fs";

import { preserveCurrentRecoveryBackup } from "../application/SetupRecoveryBackup.js";

const restrictExistingBackup = (backupPath: string): void => {
  try {
    const existing = lstatSync(backupPath);
    if (!existing.isFile())
      throw new Error("Existing Amp settings backup is not a regular file.");
    chmodSync(backupPath, 0o600);
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return;
    throw cause;
  }
};

export const writeAmpRegistrationBackup = async (
  settingsPath: string,
  settingsText: string,
): Promise<string> => {
  const firstBackupPath = `${settingsPath}.rea.backup`;
  restrictExistingBackup(firstBackupPath);
  const preserved = await preserveCurrentRecoveryBackup(
    firstBackupPath,
    settingsPath,
    settingsText,
  );
  if (!preserved.ok) throw new Error(preserved.error.detail);
  restrictExistingBackup(preserved.value);
  return preserved.value;
};
