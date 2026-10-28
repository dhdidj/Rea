import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { runNodeJsonControl } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest(
  "retains captured destructuring dependencies through CLI and a reusable MCP connection",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-destructuring-capture-");
    const relative = "source ' %/main.cjs";
    const filename = join(root, relative);
    const source = `
const config = { mode: "strict" };
const { mode: selected } = config;
config.mode = "loose";
const array = ["strict"];
const [element] = array;
array[0] = "loose";
const nested = { value: { mode: "strict" } };
const { value: { mode: deep } } = nested;
nested.value.mode = "loose";
console.log(JSON.stringify([selected, element, deep]));
`;
    await writeFixtureFiles(root, { [relative]: source });
    expect(await runNodeJsonControl(root, filename)).toEqual([
      "strict",
      "strict",
      "strict",
    ]);
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--artifact-format",
        "directory",
        "--source-path",
        relative,
        "--json",
      ],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const analysis = toolContract(
      "analyze_javascript_application",
    ).outputSchema.parse(response.json);
    const graph = javascriptApplicationAnalysisResultSchema.parse(
      analysis.normalized_result,
    ).semantic_graph;
    const { client, call } = await connectLocalToolsMcp();
    const missing = await call("trace_javascript_semantics", {
      application: {
        kind: "retained-evidence",
        evidence_id: analysis.evidence_id,
      },
      query: {
        seed: {
          kind: "semantic-node",
          node_id: graph.nodes.find(
            (node) => node.kind === "binding" && node.label === "selected",
          )!.node_id,
        },
        direction: "backward-provenance",
      },
    });
    expect(missing.isError).toBe(true);
    await client.ping();
    const retained = await call("analyze_javascript_application", {
      input_path: root,
      format: "directory",
      source_paths: [relative],
    });
    expect(retained.isError, JSON.stringify(retained.content)).not.toBe(true);
    const retainedEvidence = toolContract(
      "analyze_javascript_application",
    ).outputSchema.parse(retained.structuredContent);
    expect(retainedEvidence.evidence_id).toBe(analysis.evidence_id);
    for (const name of ["selected", "element", "deep"]) {
      const binding = graph.nodes.find(
        (node) => node.kind === "binding" && node.label === name,
      );
      expect(binding).toBeDefined();
      const query = {
        seed: { kind: "semantic-node" as const, node_id: binding!.node_id },
        direction: "backward-provenance" as const,
      };
      const request = join(root, "trace.json");
      await writeFile(
        request,
        JSON.stringify({ application: analysis, query }),
      );
      const tracedCli = await cli.run({
        arguments: ["trace-javascript-semantics", request, "--json"],
      });
      expect(tracedCli.exitCode, tracedCli.stderr).toBe(0);
      const cliEvidence = toolContract(
        "trace_javascript_semantics",
      ).outputSchema.parse(tracedCli.json);
      const traced = await call("trace_javascript_semantics", {
        application: {
          kind: "retained-evidence",
          evidence_id: analysis.evidence_id,
        },
        query,
      });
      expect(traced.isError, JSON.stringify(traced.content)).not.toBe(true);
      const mcpEvidence = toolContract(
        "trace_javascript_semantics",
      ).outputSchema.parse(traced.structuredContent);
      expect(mcpEvidence.evidence_id).toBe(cliEvidence.evidence_id);
      const trace = javaScriptSemanticTraceResultSchema.parse(
        mcpEvidence.normalized_result,
      );
      expect(trace.relations).toContainEqual(
        expect.objectContaining({
          relation: "destructures",
          target_node_id: binding!.node_id,
          resolution: "resolved",
        }),
      );
      expect(trace.nodes).toContainEqual(
        expect.objectContaining({
          kind: "literal",
          properties: expect.objectContaining({ value: "strict" }),
        }),
      );
    }
    await client.ping();
    expect(await readFile(filename, "utf8")).toBe(source);
  },
);
