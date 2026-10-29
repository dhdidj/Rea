import { describe, expect, it } from "vitest";

import { findMcpAddMissingValue } from "./cliBuiltinArguments.js";

describe("findMcpAddMissingValue", () => {
  it("ignores invocations that are not mcp add", () => {
    expect(findMcpAddMissingValue(["setup", "--client"])).toBeUndefined();
    expect(findMcpAddMissingValue(["mcp", "doctor"])).toBeUndefined();
    expect(findMcpAddMissingValue(["mcp"])).toBeUndefined();
    expect(findMcpAddMissingValue(["--mcp"])).toBeUndefined();
    expect(findMcpAddMissingValue(["--help"])).toBeUndefined();
  });

  it("accepts valued options supplied with a value", () => {
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent", "claude-code"]),
    ).toBeUndefined();
    expect(
      findMcpAddMissingValue([
        "mcp",
        "add",
        "--command",
        "fixture-server --mcp",
      ]),
    ).toBeUndefined();
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent=claude-code"]),
    ).toBeUndefined();
    expect(
      findMcpAddMissingValue(["mcp", "add", "-c", "node x.mjs"]),
    ).toBeUndefined();
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent", "amp", "--no-global"]),
    ).toBeUndefined();
  });

  it("rejects a trailing valued option without a value", () => {
    expect(findMcpAddMissingValue(["mcp", "add", "--agent"])).toBe("--agent");
    expect(findMcpAddMissingValue(["mcp", "add", "--command"])).toBe(
      "--command",
    );
    expect(findMcpAddMissingValue(["mcp", "add", "-c"])).toBe("-c");
    expect(
      findMcpAddMissingValue([
        "mcp",
        "add",
        "--agent",
        "claude-code",
        "--command",
      ]),
    ).toBe("--command");
  });

  it("rejects a valued option followed by another flag", () => {
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent", "--no-global"]),
    ).toBe("--agent");
    expect(findMcpAddMissingValue(["mcp", "add", "--command", "--json"])).toBe(
      "--command",
    );
  });

  it("leaves help requests alone", () => {
    expect(findMcpAddMissingValue(["mcp", "add", "--help"])).toBeUndefined();
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent", "--help"]),
    ).toBeUndefined();
  });

  it("still counts a lone dash as a present value", () => {
    expect(
      findMcpAddMissingValue(["mcp", "add", "--agent", "-"]),
    ).toBeUndefined();
  });
});
