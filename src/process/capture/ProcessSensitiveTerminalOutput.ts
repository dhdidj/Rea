import type { TerminalFrame } from "../../domain/process/processCapture.js";
import type { ProcessScenario } from "../../domain/process/processScenario.js";

// Limit the work of literal matching when a scenario declares many secrets.
// Over-budget output is masked in full rather than risk publishing a secret.
const MAX_REDACTION_SCAN_UNITS = 64 * 1024 * 1024;

/** Only caller-marked input is secret; include its ordinary PTY line-echo spelling. */
export const sensitiveTerminalInputValues = (
  scenario: ProcessScenario,
): readonly string[] => {
  const values = new Set<string>();
  for (const event of scenario.events) {
    if (event.type !== "input" || !event.sensitive) continue;
    if (event.data !== "") values.add(event.data);
    const echoed = event.data.replace(/[\r\n]+$/u, "");
    if (echoed !== "") values.add(echoed);
  }
  return [...values];
};

/** Choose a same-width ASCII mask absent from every declared literal. */
const safeMask = (values: readonly string[]): string | undefined => {
  for (const character of ["*", "#", "?", "!", "~"])
    if (values.every((value) => !value.includes(character))) return character;
  for (let code = 33; code <= 126; code += 1) {
    const character = String.fromCharCode(code);
    if (values.every((value) => !value.includes(character))) return character;
  }
  return undefined;
};

/** Mask all matches, including overlaps across PTY chunks, without shifting boundaries. */
export const redactTerminalChunks = (
  chunks: readonly string[],
  sensitiveValues: readonly string[],
): string[] => {
  if (chunks.length === 0 || sensitiveValues.length === 0) return [...chunks];
  const text = chunks.join("");
  if (text.length === 0) return [...chunks];
  const values = [...new Set(sensitiveValues)].filter((value) => value !== "");
  if (values.length === 0) return [...chunks];
  const mask = safeMask(values);
  // With no safe single-byte marker, or with unreasonable search work, withhold
  // output instead of retaining an unverified part of a sensitive echo.
  if (mask === undefined) return chunks.map(() => "");
  if (text.length * values.length > MAX_REDACTION_SCAN_UNITS)
    return chunks.map((chunk) => mask.repeat(chunk.length));

  const intervals = new Int32Array(text.length + 1);
  let found = false;
  for (const value of values) {
    if (value.length > text.length) continue;
    for (
      let index = text.indexOf(value);
      index !== -1;
      index = text.indexOf(value, index + 1)
    ) {
      intervals[index]! += 1;
      intervals[index + value.length]! -= 1;
      found = true;
    }
  }
  if (!found) return [...chunks];
  let offset = 0;
  let active = 0;
  return chunks.map((chunk) => {
    const units = chunk.split("");
    for (let index = 0; index < units.length; index += 1) {
      active += intervals[offset + index]!;
      if (active > 0) units[index] = mask;
    }
    offset += chunk.length;
    return units.join("");
  });
};

/** Sanitize both normalized frames and their optional original-data sidecars. */
export const redactRetainedTerminalFrames = (
  frames: TerminalFrame[],
  sensitiveValues: readonly string[],
): void => {
  if (sensitiveValues.length === 0 || frames.length === 0) return;
  const normalized = redactTerminalChunks(
    frames.map((frame) => frame.data),
    sensitiveValues,
  );
  const original = redactTerminalChunks(
    frames.map((frame) => frame.raw_data ?? frame.data),
    sensitiveValues,
  );
  for (const [index, frame] of frames.entries()) {
    const data = normalized[index]!;
    const raw = original[index]!;
    frames[index] = {
      sequence: frame.sequence,
      at_ms: frame.at_ms,
      data,
      ...(data === raw ? {} : { raw_data: raw }),
    };
  }
};
