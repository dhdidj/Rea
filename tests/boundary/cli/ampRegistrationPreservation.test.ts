import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const ampSettings = (home: string) =>
  join(home, ".config", "amp", "settings.json");

cliTest(
  "mcp add preserves Amp environment and reports unreadable settings",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-amp-registration-");
    const home = join(root, "home");
    const environment = {
      HOME: home,
      USERPROFILE: home,
    };
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: root,
        environment,
        timeoutMs: 20_000,
      });

    // An existing rea registration keeps its environment map and the file is
    // backed up before the refresh.
    const settingsPath = ampSettings(home);
    const original = JSON.stringify(
      {
        "amp.mcpServers": {
          rea: {
            command: "npx",
            args: ["-y", "rea-agents@6.8.0", "mcp"],
            env: { KEEP_ME: "1" },
          },
          other: { command: "other" },
        },
        theme: "dark",
      },
      null,
      2,
    );
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(home, ".config", "amp"), { recursive: true });
    await writeFile(settingsPath, original);

    const refreshed = await run(["mcp", "add", "--agent", "amp"]);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(after["amp.mcpServers"].rea).toMatchObject({
      command: expect.any(String),
      env: { KEEP_ME: "1" },
    });
    // A successful registration removes the backup it took.
    await expect(
      readFile(`${settingsPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
    expect(after.theme).toBe("dark");

    // The equals form --agent=amp is parsed as a spaced form before Incur sees
    // it, so the Amp registration lands and keeps the environment map.
    const equals = await run(["mcp", "add", "--agent=amp"]);
    expect(equals.exitCode, equals.stderr).toBe(0);
    const afterEquals = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(afterEquals["amp.mcpServers"].rea).toMatchObject({
      command: expect.any(String),
      env: { KEEP_ME: "1" },
    });

    // A malformed settings file is rejected instead of reporting success.
    const broken = join(root, "broken");
    const brokenSettings = ampSettings(broken);
    const malformed = '{ "amp.mcpServers": { "rea": {} ';
    await mkdir(join(broken, ".config", "amp"), { recursive: true });
    await writeFile(brokenSettings, malformed);
    const rejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: broken, USERPROFILE: broken },
      timeoutMs: 20_000,
    });
    expect(rejected.exitCode, rejected.stderr).toBe(1);
    expect(rejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_value",
          missing: false,
          path: "amp",
        }),
      ]),
    });
    expect(await readFile(brokenSettings, "utf8")).toBe(malformed);

    // An array-valued amp.mcpServers is rejected instead of claiming success.
    const arrayHome = join(root, "array");
    const arraySettings = ampSettings(arrayHome);
    const array = '{"amp.mcpServers": []}\n';
    await mkdir(join(arrayHome, ".config", "amp"), { recursive: true });
    await writeFile(arraySettings, array);
    const arrayRejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: arrayHome, USERPROFILE: arrayHome },
      timeoutMs: 20_000,
    });
    expect(arrayRejected.exitCode, arrayRejected.stderr).toBe(1);
    expect(arrayRejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_value",
          missing: false,
          path: "amp",
        }),
      ]),
    });
    expect(await readFile(arraySettings, "utf8")).toBe(array);

    // A backup write failure is reported as a filesystem problem, not as bad
    // JSON. Tighten the mode of an existing backup path before using it.
    const backupHome = join(root, "backup-error");
    const backupSettings = ampSettings(backupHome);
    const backupPath = `${backupSettings}.rea.backup`;
    await mkdir(join(backupHome, ".config", "amp"), { recursive: true });
    await writeFile(backupSettings, '{"amp.mcpServers": {}}\n');
    await mkdir(backupPath);
    const backupRejected = await cli.run({
      arguments: ["mcp", "add", "--agent", "amp", "--json"],
      cwd: root,
      environment: { HOME: backupHome, USERPROFILE: backupHome },
      timeoutMs: 20_000,
    });
    expect(backupRejected.exitCode, backupRejected.stderr).toBe(1);
    expect(backupRejected.json).toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Unable to create Amp settings backup"),
    });
    expect(backupRejected.json.message).not.toContain("not valid JSON");
    const { stat } = await import("node:fs/promises");
    if (process.platform !== "win32")
      expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
  },
);
