import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("preflights a foreign legacy registration across OpenCode layers before removal", async () => {
  const home = await createTestTempDirectory("rea-opencode-layered-uninstall-");
  const directory = join(home, ".config/opencode");
  await mkdir(directory, { recursive: true });
  const lower = join(directory, "opencode.json");
  const upper = join(directory, "opencode.jsonc");
  const legacy = JSON.stringify({
    mcp: { rea: { type: "local", command: ["/usr/bin/false"], enabled: true } },
  });
  const native = JSON.stringify({
    mcp: {
      servers: {
        rea: { type: "local", command: ["rea", "mcp"], disabled: false },
      },
    },
  });
  await writeFile(lower, legacy);
  await writeFile(upper, native);
  const environment = { XDG_CONFIG_HOME: join(home, ".config") };
  const blocked = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(blocked.status).toBe("failed");
  expect(blocked.items).toContainEqual(
    expect.objectContaining({
      name: "opencode",
      status: "failed",
      detail: expect.stringContaining("V1"),
    }),
  );
  expect(await readFile(lower, "utf8")).toBe(legacy);
  expect(await readFile(upper, "utf8")).toBe(native);
  await expect(access(`${lower}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(`${upper}.rea.backup`)).rejects.toMatchObject({
    code: "ENOENT",
  });

  await writeFile(lower, "{}\n");
  const removed = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(removed.status).toBe("complete");
  expect(removed.items).toContainEqual(
    expect.objectContaining({ name: "opencode", status: "removed" }),
  );
  expect(await readFile(upper, "utf8")).not.toContain('"rea"');

  // Removing a shadowed owned registration does not activate a registration
  // that was already selected from a later layer.
  await writeFile(lower, native);
  const foreignNative = JSON.stringify({
    mcp: {
      servers: {
        rea: { type: "local", command: ["/usr/bin/false"], disabled: false },
      },
    },
  });
  await writeFile(upper, foreignNative);
  const alreadyForeign = await runUninstall(
    false,
    systemUninstallHost(home, undefined, environment),
  );
  expect(alreadyForeign.status).toBe("complete");
  expect(await readFile(lower, "utf8")).not.toContain('"rea"');
  expect(await readFile(upper, "utf8")).toBe(foreignNative);
});
