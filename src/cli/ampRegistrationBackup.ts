import { chmodSync, lstatSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

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

const copyPrivateBackup = async (
  sourcePath: string,
  backupPath: string,
): Promise<void> => {
  await writeFile(backupPath, await readFile(sourcePath), {
    flag: "wx",
    mode: 0o600,
  });
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
    { copy: copyPrivateBackup },
  );
  if (!preserved.ok) throw new Error(preserved.error.detail);
  restrictExistingBackup(preserved.value);
  return preserved.value;
};
