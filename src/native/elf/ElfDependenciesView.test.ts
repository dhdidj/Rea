import { expect, it } from "vitest";
import { parseElfDependencies } from "./ElfDependencyParser.js";
import { elfDependencyFixture } from "./ElfDependencies.fixture.js";
import { freezeJsonSnapshot } from "../../domain/immutableJson.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewParent,
} from "../../domain/analysisView/analysisView.js";

const artifact = {
  path: "/artifacts/program",
  sha256: "a".repeat(64),
  bytes: 2048,
};

const parent = (report: unknown): AnalysisViewParent => ({
  evidenceId: `ev_${"b".repeat(64)}`,
  operation: "inspect_elf_dependencies",
  normalizedResult: report,
  limitations: [],
});

const project = (report: unknown, input: unknown) => {
  const result = projectAnalysisView(
    parent(report),
    analysisViewRequestSchema.parse(input),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const reportOf = () =>
  parseElfDependencies(
    elfDependencyFixture({
      needed: ["libc.so.6", "libc.so.6", "libm.so.6"],
    }),
    artifact,
    {
      path: artifact.path,
      max_file_bytes: 67108864,
      max_needed: 1024,
      max_versions: 4096,
      max_imports: 65536,
    },
  );

it("pages duplicate DT_NEEDED names with original indices and selected fields", () => {
  const report = reportOf();
  const input = {
    kind: "elf-dependencies",
    collection: "needed",
    names: ["libc.so.6"],
    fields: ["name"],
    limit: 1,
  };
  expect(project(report, input)).toMatchObject({
    items: [{ source_index: 0, name: "libc.so.6" }],
    dependencies: { needed_count: 3, coverage: { status: "complete" } },
    coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
  });
  expect(project(report, { ...input, offset: 1 })).toMatchObject({
    items: [{ source_index: 1, name: "libc.so.6" }],
    coverage: { total: 2, next_offset: null, exhausted: true },
  });
  expect(
    project(report, { ...input, indices: [1, 1, 99], fields: [] }),
  ).toMatchObject({ items: [{ source_index: 1 }], coverage: { total: 1 } });
  expect(project(report, { ...input, names: [] })).toMatchObject({
    items: [],
    coverage: { status: "empty", total: 0 },
  });
});

it("pages GNU version requirements independently of definition rows", () => {
  const report = reportOf();
  expect(
    project(report, {
      kind: "elf-dependencies",
      collection: "versions",
      names: ["GLIBC_2.34"],
      fields: ["file", "name", "index"],
    }),
  ).toMatchObject({
    items: [
      {
        source_index: 1,
        file: "libc.so.6",
        name: "GLIBC_2.34",
        index: 3,
      },
    ],
    coverage: { total: 1 },
  });
});

it("keeps import library@version identity through selected fields", () => {
  const report = reportOf();
  expect(
    project(report, {
      kind: "elf-dependencies",
      collection: "imports",
      names: ["printf"],
      fields: ["name", "version"],
    }),
  ).toMatchObject({
    items: [
      {
        source_index: 0,
        name: "printf",
        version: {
          name: "GLIBC_2.34",
          file: "libc.so.6",
          status: "resolved",
        },
      },
    ],
  });
});

it("returns a summary without row bodies and a stable view digest", () => {
  const report = reportOf();
  freezeJsonSnapshot(report);
  const viewed = project(report, { kind: "summary" });
  expect(viewed).toMatchObject({
    kind: "summary",
    parent_operation: "inspect_elf_dependencies",
    summary: {
      needed_count: 3,
      import_count: 5,
      coverage: { status: "complete" },
    },
  });
  expect(viewed).not.toHaveProperty("items");
  const { view_digest, ...content } = viewed;
  expect(view_digest).toBe(digestCanonicalValue(content, "Analysis view"));
});
