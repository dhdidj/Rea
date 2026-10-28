import { parseRecordedTransportUrl } from "../domain/recordedTransportUrl.js";

const HTTP_SCHEME = /https?:\/\//giu;
const URL_END = /[\s"'<>[\]{}(),]/u;
const AMBIGUOUS = "[HTTP URL omitted: credential span unresolved]";
const INCOMPLETE = "[HTTP URL omitted: incomplete authority]";

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** Derive only transport-userinfo edits from the shared recorded URL parser. */
const urlEdits = (text: string, incomplete: boolean): TextEdit[] => {
  const edits: TextEdit[] = [];
  for (const match of text.matchAll(HTTP_SCHEME)) {
    const start = match.index;
    let end = start + match[0].length;
    while (end < text.length && !URL_END.test(text[end]!)) end += 1;
    const url = text.slice(start, end);
    const { credentials } = parseRecordedTransportUrl(url);
    if (credentials === "ambiguous") {
      edits.push({ start, end, replacement: AMBIGUOUS });
    } else if (credentials !== null) {
      edits.push({
        start: start + credentials.start,
        end: start + credentials.end,
        replacement: "",
      });
    } else if (incomplete && end === text.length) {
      // The output cap can stop before the '@' that closes a credential.
      const authority = url.slice(match[0].length);
      if (authority !== "" && !/[/?#]/u.test(authority))
        edits.push({
          start: start + match[0].length,
          end,
          replacement: INCOMPLETE,
        });
    }
  }
  return edits;
};

const applyEdits = (text: string, edits: readonly TextEdit[]): string => {
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!;
    text =
      text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
};

/** Map decoded JSON character positions to original JSON source coordinates. */
const jsonSourceOffsets = (encoded: string, length: number): number[] => {
  const positions = [0];
  let source = 0;
  for (let index = 0; index < length; index += 1) {
    if (encoded[source] === "\\")
      source += encoded[source + 1] === "u" ? 6 : 2;
    else source += 1;
    positions.push(source);
  }
  return positions;
};

/** Decode one complete JSON string without re-encoding its unaffected bytes. */
const redactEncodedJson = (encoded: string, incomplete: boolean): string => {
  const decoded: unknown = JSON.parse("\"" + encoded + "\"");
  if (typeof decoded !== "string") return encoded;
  const edits = urlEdits(decoded, incomplete);
  if (edits.length === 0) return encoded;
  const positions = jsonSourceOffsets(encoded, decoded.length);
  return applyEdits(
    encoded,
    edits.map((edit) => ({
      start: positions[edit.start]!,
      end: positions[edit.end]!,
      replacement: JSON.stringify(edit.replacement).slice(1, -1),
    })),
  );
};

/** Handle Wireshark JSON strings even when slash/userinfo uses JSON escapes. */
const redactJsonStrings = (text: string, truncated: boolean): string => {
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const opening = text.indexOf('"', cursor);
    if (opening < 0) break;
    let closing = opening + 1;
    let escaped = false;
    for (; closing < text.length; closing += 1) {
      const character = text[closing];
      if (!escaped && character === '"') break;
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    const complete = closing < text.length;
    const encoded = text.slice(opening + 1, complete ? closing : undefined);
    let safe = encoded;
    try {
      safe = redactEncodedJson(encoded, truncated && !complete);
    } catch {
      // A malformed producer string is still checked in raw spelling below.
    }
    result += text.slice(cursor, opening + 1) + safe;
    if (!complete) {
      cursor = text.length;
      break;
    }
    result += '"';
    cursor = closing + 1;
  }
  return result + text.slice(cursor);
};

/** Bounded failure/cleanup projection shared by the packet-capture provider. */
export const redactPcapDiagnostic = (
  text: string,
  truncated = false,
): string => {
  const safeJson = redactJsonStrings(text, truncated);
  return applyEdits(safeJson, urlEdits(safeJson, truncated));
};
