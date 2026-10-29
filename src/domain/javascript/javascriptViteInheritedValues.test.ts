import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const helper = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./first.js","./last.js"])))=>i.map(i=>d[i]);`;
const candidates = (source: string) =>
  analyzeJavaScriptStaticSource(helper + source)
    .references.filter(({ kind }) => kind === "vite-table-candidate")
    .map(({ specifier }) => specifier);

describe("Vite inherited dependency values", () => {
  it("keeps unrelated direct intrinsic writes and prototype assignments precise", () => {
    expect(
      candidates(`Array.prototype[2] = 1; __vite__mapDeps([,0]);`),
    ).toEqual(["./first.js"]);
    expect(
      candidates(
        `const getProto = Object.getPrototypeOf; const proto = {}; const box = {}; box.object = Object.create(proto); const captured = getProto(box.object); Object.setPrototypeOf(box.object, Array.prototype); captured.label = 1; __vite__mapDeps([0]);`,
      ),
    ).toEqual(["./first.js"]);
    expect(
      candidates(
        `Object.defineProperty(Array.prototype, "1", {get() { this[0] = "./last.js"; return 1; }, configurable: true}); __vite__mapDeps([1], void 0, []); __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, "./first.js"]);
    const source =
      helper.replace(
        '["./first.js","./last.js"]',
        '["./first.js",null,"./last.js"]',
      ) +
      `Object.defineProperty(Array.prototype,"1",{get(){return 1},configurable:true}); __vite__mapDeps([1,2]);`;
    expect(
      analyzeJavaScriptStaticSource(source)
        .references.filter(({ kind }) => kind === "vite-table-candidate")
        .map(({ specifier }) => specifier),
    ).toEqual([null, "./last.js"]);
  });
  it("distinguishes independent owned values from inherited prototypes", () => {
    for (const key of ["constructor", "__proto__"]) {
      const effect = `const values=__vite__mapDeps([${JSON.stringify(key)}], void 0, {[${JSON.stringify(key)}]: {}}); opaque(values); __vite__mapDeps([0]);`;
      expect(
        Array.from(runInNewContext(helper + effect, { opaque: () => {} })),
      ).toEqual(["./first.js"]);
      expect(candidates(effect)).toEqual([null, "./first.js"]);
    }
  });

  it("retains an explicit shared prototype stored under an arbitrary own key", () => {
    for (const value of [
      "Array.prototype",
      "globalThis.Array.prototype",
      "Object.prototype",
      "Array",
    ]) {
      const effect = `const values=__vite__mapDeps(['foo'], void 0, {foo:${value}}); opaque(values); __vite__mapDeps([0]);`;
      expect(candidates(effect)).toEqual([null, null]);
    }
    const effect = `const values=__vite__mapDeps(['foo'], void 0, {foo:Array.prototype}); opaque(values); __vite__mapDeps([0]);`;
    expect(
      candidates(
        `const values=__vite__mapDeps(['foo'], void 0, {foo:Array.prototype}); opaque(values[0]); __vite__mapDeps([0]);`,
      ),
    ).toEqual([null, null]);
    expect(
      Array.from(
        runInNewContext(helper + effect, {
          opaque: (values: { map: () => string[] }[]) => {
            const value = values[0];
            if (value !== undefined) value.map = () => ["./last.js"];
          },
        }),
      ),
    ).toEqual(["./last.js"]);
  });

  it("retains possible inherited values after a table property is deleted", () => {
    const effect = `const table = { constructor: {} }; delete table.constructor; const values=__vite__mapDeps(['constructor'], void 0, table); opaque(values); __vite__mapDeps([0]);`;
    expect(candidates(effect)).toEqual([null, null]);
  });

  it("respects table writes after the mapped selection", () => {
    const effect = `const table = { constructor: {} }; const values=__vite__mapDeps(['constructor'], void 0, table); delete table.constructor; opaque(values); __vite__mapDeps([0]);`;
    expect(candidates(effect)).toEqual([null, "./first.js"]);
  });

  it("tracks a prototype returned by an own getter", () => {
    const effect = `const values=__vite__mapDeps(['constructor'], void 0, {get constructor() { return Array.prototype; }}); opaque(values); __vite__mapDeps([0]);`;
    expect(candidates(effect)).toEqual([null, null]);
  });

  it("does not assume an unknown own value is independent", () => {
    for (const table of ["{foo:external}", "[external]"]) {
      const key = table.startsWith("{") ? "'foo'" : "0";
      expect(
        candidates(
          `const values=__vite__mapDeps([${key}],void 0,${table}); opaque(values); __vite__mapDeps([0]);`,
        ),
      ).toEqual([null, null]);
    }
  });

  it("does not assume an unknown supplied table is independent", () => {
    const effect = `const values=__vite__mapDeps(['foo'],void 0,makeTable()); opaque(values); __vite__mapDeps([0]);`;
    expect(candidates(effect)).toEqual([null, null]);
  });

  it("tracks an arbitrary slot replaced before mapping and preserves known values", () => {
    const changed = `const table={foo:{}}; table.foo=Array.prototype; const values=__vite__mapDeps(['foo'],void 0,table); opaque(values); __vite__mapDeps([0]);`;
    expect(candidates(changed)).toEqual([null, null]);
    expect(
      candidates(
        `const values=__vite__mapDeps([0]); opaque(values); __vite__mapDeps([0]);`,
      ),
    ).toEqual(["./first.js", "./first.js"]);
  });
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
