import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { RetainedRegularFileCleanupFailure } from "./RegularFileRead.js";
import { MANAGED_SKILL_FILES } from "./SetupSkill.js";
import {
  readGuidanceSectionWithReader,
  searchGuidanceWithReader,
} from "./GuidanceAccess.js";

const gate = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const content = (path: string) =>
  path === MANAGED_SKILL_FILES[0] ? "# needle\nInstructions\n" : "# Other\n";

it.each(["search", "read"] as const)(
  "finishes every guide in an admitted %s while shutdown waits",
  async (action) => {
    const resources = new ArtifactResourceScope();
    const initial = await searchGuidanceWithReader(
      { query: "needle" },
      async (path) => content(path),
      resources,
    );
    if (!initial.ok || initial.value.status !== "matches")
      throw new Error("Expected match");
    const reached = gate();
    const resume = gate();
    const paths: string[] = [];
    const reader = (path: string, admitted = resources) =>
      admitted.run(async () => {
        paths.push(path);
        if (path === MANAGED_SKILL_FILES[1]) {
          reached.release();
          await resume.promise;
        }
        return content(path);
      });
    const operation =
      action === "search"
        ? searchGuidanceWithReader({ query: "needle" }, reader, resources)
        : readGuidanceSectionWithReader(
            { locator: initial.value.matches[0]?.locator },
            reader,
            resources,
          );
    await reached.promise;
    let closed = false;
    const closing = resources.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    resume.release();
    expect(await operation).toMatchObject({
      ok: true,
      value: { status: action === "search" ? "matches" : "section" },
    });
    await closing;
    expect(paths).toEqual(MANAGED_SKILL_FILES);
    expect(closed).toBe(true);
    expect(resources.hasPending).toBe(false);
  },
);

it("retains a failed child while another admitted request reaches later reads", async () => {
  const resources = new ArtifactResourceScope();
  const reached = gate();
  const resume = gate();
  const paths: string[] = [];
  let blocked = true;
  const failure = new RetainedRegularFileCleanupFailure(
    new RegularFileCleanupFailure({
      path: "owned guidance descriptor",
      owner: {
        close: async () => {
          if (blocked) throw new Error("close denied");
        },
      } as never,
      outcome: { kind: "failed", cause: new Error("read failed") },
      cleanupCause: new Error("close denied"),
    }),
  );
  const active = searchGuidanceWithReader(
    { query: "needle" },
    (path, child) =>
      child.run(async () => {
        paths.push(path);
        if (path === MANAGED_SKILL_FILES[1]) {
          reached.release();
          await resume.promise;
        }
        return content(path);
      }),
    resources,
  );
  await reached.promise;
  const failed = await searchGuidanceWithReader(
    { query: "needle" },
    async (_path, child) => {
      child.retain(failure.cleanupOwner);
      throw failure;
    },
    resources,
  );
  if (failed.ok) throw new Error("Expected cleanup failure");
  expect(failed.error.cleanupResources).toEqual(["owned guidance descriptor"]);
  expect(failed.error.cleanupIncomplete).toBe(true);
  const closing = resources.close().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  resume.release();
  expect(await active).toMatchObject({
    ok: true,
    value: { status: "matches" },
  });
  expect(paths).toEqual(MANAGED_SKILL_FILES);
  expect(await closing).toMatchObject({
    cleanup: { resources: ["owned guidance descriptor"] },
  });
  expect(resources.hasPending).toBe(true);
  expect(failed.error.cleanupIncomplete).toBe(true);
  blocked = false;
  await resources.close();
  expect(resources.hasPending).toBe(false);
  expect(failed.error.cleanupIncomplete).toBe(false);
});

it("refuses new work after shutdown without reporting a missing bundle", async () => {
  const resources = new ArtifactResourceScope();
  await resources.close();
  let reads = 0;
  await expect(
    searchGuidanceWithReader(
      { query: "needle" },
      async (path) => {
        reads += 1;
        return content(path);
      },
      resources,
    ),
  ).rejects.toMatchObject({ reason: "unavailable" });
  expect(reads).toBe(0);
});
