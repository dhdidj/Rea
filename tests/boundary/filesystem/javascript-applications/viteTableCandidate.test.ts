import { expect, it } from "vitest";

import { compareJavaScriptApplicationVersions } from "../../../../src/domain/javascript/javascriptApplicationVersionComparison.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  reconstructJavaScriptFixture,
  writeFixtureFiles,
} from "../../../support/javascriptApplicationFixture.js";

it("keeps Vite table candidates uncertain while direct imports still resolve", async () => {
  const root = await createTestTempDirectory("rea-vite-table-candidate-");
  await writeFixtureFiles(root, {
    "assets/main.js": `
      const __vite__mapDeps = (i, m = __vite__mapDeps,
        d = (m.f || (m.f = ["./lazy.js"]))) => i.map(i => d[i]);
      const helper = deps => deps.map(dep => "https://elsewhere.test/other.js");
      helper(__vite__mapDeps([0]));
      import("./lazy.js");
      import("vite-output:assets/lazy.js");
    `,
    "assets/lazy.js": "export const lazy = true;",
  });
  const result = await reconstructJavaScriptFixture(root);
  expect(result.graph.coverage.status).toBe("partial");
  const comparison = compareJavaScriptApplicationVersions({
    left: {
      evidenceId: `ev_${"a".repeat(64)}`,
      rootArtifactSha256: result.root_artifact_sha256,
      graph: result.graph,
    },
    right: {
      evidenceId: `ev_${"b".repeat(64)}`,
      rootArtifactSha256: result.root_artifact_sha256,
      graph: result.graph,
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });
  expect(
    comparison.items
      .filter((item) => item.node_kind === "javascript-asset")
      .map((item) => item.status),
  ).toEqual(expect.arrayContaining(["unknown"]));
  expect(
    comparison.items.filter(
      (item) =>
        item.node_kind === "javascript-asset" && item.status === "unchanged",
    ),
  ).toHaveLength(0);
  const edges = result.graph.edges.filter(
    (edge) =>
      edge.relation === "imports" && edge.properties.specifier === "./lazy.js",
  );
  expect(edges).toHaveLength(1);
  expect(edges[0]?.properties).toMatchObject({
    resolution_status: "resolved",
    resolved_path: "assets/lazy.js",
  });
  expect(result.graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          specifier: "vite-output:assets/lazy.js",
          resolution_status: "external",
          resolved_path: null,
        }),
      }),
    ]),
  );
  const candidates = result.graph.nodes.filter(
    (node) =>
      node.kind === "unknown" &&
      node.observations.some((o) => o.properties.vite_table_candidate === true),
  );
  expect(candidates).toHaveLength(1);
  expect(
    result.graph.nodes.filter(
      (node) =>
        node.kind === "javascript-module" &&
        node.observations.some(
          (o) =>
            o.properties.specifier === "./lazy.js" &&
            o.properties.resolution === "unresolved",
        ),
    ),
  ).toHaveLength(0);
  expect(candidates[0]?.observations[0]?.properties).toMatchObject({
    specifier: "./lazy.js",
    resolution_status: "unavailable",
    candidate_path: "assets/lazy.js",
  });
});
