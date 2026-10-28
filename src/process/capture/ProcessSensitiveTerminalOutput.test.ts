import { expect, it } from "vitest";
import { processScenarioSchema } from "../../domain/process/processScenario.js";
import {
  sensitiveTerminalInputValues,
  redactTerminalChunks,
  redactRetainedTerminalFrames,
  redactTerminalSerialization,
} from "./ProcessSensitiveTerminalOutput.js";

it("uses only explicitly sensitive input values, including ordinary line echo", () => {
  const scenario = processScenarioSchema.parse({
    executable: "unused",
    events: [
      { at_ms: 0, type: "input", data: "hidden-token\n", sensitive: true },
      { at_ms: 1, type: "input", data: "visible", sensitive: false },
    ],
  });
  expect(sensitiveTerminalInputValues(scenario)).toEqual([
    "hidden-token\n",
    "hidden-token",
  ]);
});

it("masks split echoes across frame boundaries without changing unmarked output", () => {
  expect(redactTerminalChunks(
    ["normal sec", "ret follows", " visible"],
    ["secret"],
  )).toEqual(["normal ***", "*** follows", " visible"]);
});

it("masks overlapping declarations and preserves chunk boundaries", () => {
  expect(redactTerminalChunks(["ab", "cd"], ["abc", "bcd"])).toEqual([
    "**",
    "**",
  ]);
});

it("masks both normalized output and raw-data backups", () => {
  const frames = [
    { sequence: 0, at_ms: 1, data: "sec", raw_data: "raw sec" },
    { sequence: 1, at_ms: 2, data: "ret", raw_data: "ret" },
  ];
  redactRetainedTerminalFrames(frames, ["secret"]);
  expect(JSON.stringify(frames)).not.toContain("secret");
  expect(frames.map((frame) => frame.data).join("")).toBe("******");
  expect(frames.map((frame) => frame.raw_data ?? frame.data).join(""))
    .toBe("raw ******");
});

it("preserves ordinary output when no sensitive input was declared", () => {
  expect(redactTerminalChunks(["hello", " world"], [])).toEqual([
    "hello",
    " world",
  ]);
});

it("preserves ANSI styling commands when the secret matches color digits", () => {
  const ansi = "\u001b[31m12\u001b[0m";
  expect(redactTerminalSerialization(ansi, ["12"])).toBe(
    "\u001b[31m**\u001b[0m",
  );
});

it("keeps Unicode masking bounded and never retains the explicit value", () => {
  const frames = [
    { sequence: 0, at_ms: 1, data: "é", raw_data: "é" },
  ];
  redactRetainedTerminalFrames(frames, ["é"]);
  expect(JSON.stringify(frames)).not.toContain("é");
  expect(frames[0]?.data).toBe("*");
  expect(Buffer.byteLength(frames[0]!.data)).toBe(1);
});

it("masks split terminal echoes while retaining ANSI parameters", () => {
  const frames = [
    { sequence: 0, at_ms: 0, data: "\u001b[31msec" },
    { sequence: 1, at_ms: 1, data: "ret\u001b[0m" },
  ];
  redactRetainedTerminalFrames(frames, ["secret"]);
  expect(frames.map((frame) => frame.data).join("")).toBe(
    "\u001b[31m******\u001b[0m",
  );
});
