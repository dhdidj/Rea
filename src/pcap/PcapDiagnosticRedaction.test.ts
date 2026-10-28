import { expect, it } from "vitest";
import { redactPcapDiagnostic } from "./PcapDiagnosticRedaction.js";

it.each([
  ["http://user:pass@example.test/a?x=y", "http://example.test/a?x=y"],
  ["https://user@example.test/a", "https://example.test/a"],
  ["see https://a:b@example.test/a and http://x:y@example.test/z", "see https://example.test/a and http://example.test/z"],
  ["email user@example.test and /tmp/user@host", "email user@example.test and /tmp/user@host"],
  ["ftp://user:pass@example.test/f", "ftp://user:pass@example.test/f"],
  [
    '{"http.request.full_uri":["http://user:pass@example.test/private"]}',
    '{"http.request.full_uri":["http://example.test/private"]}',
  ],
  [
    '{"uri":"http:\\/\\/user:pass@example.test/private"}',
    '{"uri":"http:\\/\\/example.test/private"}',
  ],
])("excludes HTTP userinfo without changing unrelated diagnostics", (input, expected) => {
  expect(redactPcapDiagnostic(input)).toBe(expected);
});

it("withholds incomplete authority on truncated output", () => {
  expect(redactPcapDiagnostic("before http://user:pass", true)).toBe(
    "before http://[HTTP URL omitted: incomplete authority]",
  );
  expect(redactPcapDiagnostic("before http://example.test/path", true)).toBe(
    "before http://example.test/path",
  );
});
