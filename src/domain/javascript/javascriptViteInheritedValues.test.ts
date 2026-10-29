import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const helper = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./first.js","./last.js"])))=>i.map(i=>d[i]);`;
const candidates = (source: string) =>
  analyzeJavaScriptStaticSource(helper + source)
    .references.filter(({ kind }) => kind === "vite-table-candidate")
    .map(({ specifier }) => specifier);

describe("Vite inherited dependency values", () => {
  it("retains possible inherited prototype effects separately from table elements", () => {
    const effect = `const key="__proto__"; const proto=__vite__mapDeps([key])[0]; proto.map=function(){return ["./last.js"]}; __vite__mapDeps([0]);`;
    expect(Array.from(runInNewContext(helper + effect))).toEqual(["./last.js"]);
    expect(candidates(effect)).toEqual([null, null]);
    expect(
      candidates(
        `const key="__proto__"; const proto=__vite__mapDeps([key])[0]; proto.irrelevant=1; __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, "./first.js"]);
    expect(
      candidates(
        `const key="__proto__"; const proto=__vite__mapDeps([key])[0]; opaque(proto); __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, null]);
    expect(
      candidates(
        `const key="constructor"; const proto=__vite__mapDeps([key])[0]; proto.prototype.map=()=>["./last.js"]; __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, null]);
  });

  it.each([
    `Object.defineProperty(proto, "map", { value: () => ["./last.js"] });`,
    `Object.assign(proto, { map: () => ["./last.js"] });`,
    `proto.change = function() { this.map = () => ["./last.js"]; }; proto.change();`,
    `external.saved = proto;`,
  ])("retains inherited prototype exposure through %s", (effect) => {
    expect(
      candidates(
        `const key = "__proto__"; const proto = __vite__mapDeps([key])[0]; ${effect} __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, null]);
  });

  it("exposes only iterated values to for-await thenable hooks", () => {
    const init = `const initialize=__vite__mapDeps; initialize([]);`;
    expect(
      candidates(
        init +
          `const items=["text"]; items.extra=__vite__mapDeps.f; for await (const x of items) { void x; } __vite__mapDeps([0]);`,
      ),
    ).toEqual(["./first.js"]);
    expect(
      candidates(
        init +
          `const items=[__vite__mapDeps.f]; for await (const x of items) { void x; } __vite__mapDeps([0]);`,
      ),
    ).toEqual([null]);
  });

  it("copies only array elements for array spread and keeps object spread semantics", () => {
    const init = `const initialize=__vite__mapDeps; initialize([]);`;
    const source = `const items=["text"]; items.extra=__vite__mapDeps.f;`;
    expect(
      candidates(
        init +
          source +
          `const copy=[...items]; opaque(copy); __vite__mapDeps([0]);`,
      ),
    ).toEqual(["./first.js"]);
    expect(
      candidates(
        init +
          source +
          `const copy={...items}; opaque(copy); __vite__mapDeps([0]);`,
      ),
    ).toEqual([null]);
    expect(
      candidates(
        init +
          `const items=[__vite__mapDeps.f]; const copy=[...items]; opaque(copy); __vite__mapDeps([0]);`,
      ),
    ).toEqual([null]);
  });
});
