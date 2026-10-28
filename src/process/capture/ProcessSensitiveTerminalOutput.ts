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

/** Choose a one-code-unit mask absent from every declared literal. */
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

  if (text.length > MAX_REDACTION_SCAN_UNITS)
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

/** Redact printable terminal text, never control-sequence parameters.
 * Both PTY chunks and xterm's serialized replay can contain ANSI commands.
 * Splitting by printable runs preserves the terminal instruction grammar.
 */
export const redactTerminalSerialization = (
  serialized: string,
  sensitiveValues: readonly string[],
): string => {
  if (sensitiveValues.length === 0 || serialized === "") return serialized;
  const segments: Array<{ readonly text: string; readonly printable: boolean }> = [];
  let position = 0;
  let plainStart = 0;
  const protect = (end: number): void => {
    if (plainStart < position)
      segments.push({ text: serialized.slice(plainStart, position), printable: true });
    segments.push({ text: serialized.slice(position, end), printable: false });
    position = end;
    plainStart = end;
  };
  while (position < serialized.length) {
    const code = serialized.charCodeAt(position);
    if (code === 0x1b) {
      const selector = serialized[position + 1];
      if (selector === undefined) return "";
      if (selector === "[") {
        let end = position + 2;
        while (end < serialized.length) {
          const c = serialized.charCodeAt(end);
          if (c >= 0x40 && c <= 0x7e) break;
          if (c < 0x20 || c > 0x3f) return "";
          end += 1;
        }
        if (end === serialized.length) return "";
        protect(end + 1);
        continue;
      }
      if (
        selector === "]" ||
        selector === "P" ||
        selector === "_" ||
        selector === "^" ||
        selector === "X"
      ) {
        let end = position + 2;
        while (end < serialized.length) {
          if (serialized.charCodeAt(end) === 7) {
            end += 1;
            break;
          }
          if (serialized.charCodeAt(end) === 0x1b &&
              serialized[end + 1] === "\\") {
            end += 2;
            break;
          }
          end += 1;
        }
        if (end > serialized.length ||
            (end === serialized.length &&
              serialized[end - 1] !== "\u0007" &&
              serialized.slice(-2) !== "\u001b\\")) return "";
        protect(end);
        continue;
      }
      protect(position + 2);
      continue;
    }
    // C0, DEL and C1 bytes are terminal controls, not printable characters.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      protect(position + 1);
      continue;
    }
    position += 1;
  }
  if (plainStart < position)
    segments.push({ text: serialized.slice(plainStart), printable: true });
  const redacted = redactTerminalChunks(
    segments.filter((segment) => segment.printable).map((segment) => segment.text),
    sensitiveValues,
  );
  let next = 0;
  return segments.map((segment) =>
    segment.printable ? (redacted[next++] ?? "") : segment.text
  ).join("");
};

/** Apply one format-aware redaction over all PTY chunks, then restore boundaries. */
const redactFrameChunks = (
  chunks: readonly string[],
  sensitiveValues: readonly string[],
): string[] => {
  const redacted = redactTerminalSerialization(chunks.join(""), sensitiveValues);
  // Malformed terminal escapes are withheld rather than publishing unverified data.
  if (redacted.length !== chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    return chunks.map(() => "");
  let offset = 0;
  return chunks.map((chunk) => {
    const part = redacted.slice(offset, offset + chunk.length);
    offset += chunk.length;
    return part;
  });
};

/** Sanitize both normalized frames and their optional original-data sidecars. */
export const redactRetainedTerminalFrames = (
  frames: TerminalFrame[],
  sensitiveValues: readonly string[],
): void => {
  if (sensitiveValues.length === 0 || frames.length === 0) return;
  const normalized = redactFrameChunks(
    frames.map((frame) => frame.data),
    sensitiveValues,
  );
  const original = redactFrameChunks(
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
