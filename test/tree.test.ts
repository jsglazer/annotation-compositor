import { describe, expect, it } from "vitest";
import {
  buildViewModel,
  collectExistingPaths,
  collectFolderKeys,
} from "../src/core/tree.js";
import { PREFIX, annotation, sampleAnnotations } from "./fixtures.js";

describe("buildViewModel", () => {
  it("maps flat tags to the expected tree JSON", () => {
    const model = buildViewModel(sampleAnnotations(), PREFIX);
    expect(model.folders.map((folder) => folder.key)).toEqual(["Methods", "Results"]);

    const methods = model.folders[0];
    expect(methods.directCount).toBe(2); // a1, a4
    expect(methods.totalCount).toBe(4); // + a2, a3
    expect(methods.hasChildren).toBe(true);
    expect(methods.children.map((child) => child.key)).toEqual(["Methods/Sampling"]);
  });

  it("nests 3+ levels and preserves special characters in names", () => {
    const model = buildViewModel(sampleAnnotations(), PREFIX);
    const deep = model.folders[0].children[0].children[0].children[0];
    expect(deep.path).toEqual(["Methods", "Sampling", "Bias & Error", "Deep"]);
    expect(deep.name).toBe("Deep");
    expect(deep.annotationIds).toEqual(["a3"]);
    expect(deep.hasChildren).toBe(false);
  });

  it("counts an annotation once per subtree despite multi-membership", () => {
    const annotations = [annotation("m1", ["grp/A", "grp/A/B", "grp/A/B/C"])];
    const model = buildViewModel(annotations, PREFIX);
    expect(model.folders[0].totalCount).toBe(1);
    expect(model.folders[0].directCount).toBe(1);
    expect(collectFolderKeys(model.folders)).toEqual(["A", "A/B", "A/B/C"]);
  });

  it("derives Ungrouped from the absence of a prefixed tag", () => {
    const model = buildViewModel(sampleAnnotations(), PREFIX);
    expect(model.ungrouped.map((a) => a.id)).toEqual(["a5"]);
    expect(collectFolderKeys(model.folders)).not.toContain("Ungrouped");
    expect(model.totalCount).toBe(5);
  });

  it("ignores malformed and over-deep group tags", () => {
    const annotations = [
      annotation("bad", ["grp//Empty", "grp", "grp/1/2/3/4/5", "grp/Good"]),
    ];
    const model = buildViewModel(annotations, PREFIX);
    expect(collectFolderKeys(model.folders)).toEqual(["Good"]);
  });

  it("orders annotation ids by annotationSortIndex", () => {
    const annotations = [
      annotation("late", ["grp/A"], { sortIndex: "00009|000000|00000" }),
      annotation("early", ["grp/A"], { sortIndex: "00001|000000|00000" }),
    ];
    const model = buildViewModel(annotations, PREFIX);
    expect(model.folders[0].annotationIds).toEqual(["early", "late"]);
  });

  it("omits the children of a collapsed node entirely", () => {
    const model = buildViewModel(sampleAnnotations(), PREFIX, {
      collapsedKeys: ["Methods"],
    });
    const methods = model.folders[0];
    expect(methods.collapsed).toBe(true);
    expect(methods.children).toEqual([]);
    expect(methods.hasChildren).toBe(true);
    expect(methods.totalCount).toBe(4); // rollup still correct
  });

  it("shows empty folders that exist only in UI state", () => {
    const model = buildViewModel([], PREFIX, { pendingFolderKeys: ["New/Child"] });
    expect(collectFolderKeys(model.folders)).toEqual(["New", "New/Child"]);
    expect(model.folders[0].totalCount).toBe(0);
  });

  it("filters case-insensitively across text, comment and folder names", () => {
    const model = buildViewModel(sampleAnnotations(), PREFIX, { filter: "sampling" });
    expect(Object.keys(model.annotationsById).sort()).toEqual(["a1", "a2", "a3"]);
    expect(model.ungrouped).toEqual([]);
  });

  it("does not mutate its input", () => {
    const annotations = sampleAnnotations();
    const before = JSON.stringify(annotations);
    buildViewModel(annotations, PREFIX, { collapsedKeys: ["Methods"] });
    expect(JSON.stringify(annotations)).toBe(before);
  });

  it("collects every existing path including implied ancestors", () => {
    expect(collectExistingPaths(sampleAnnotations(), PREFIX)).toEqual([
      ["Methods"],
      ["Methods", "Sampling"],
      ["Methods", "Sampling", "Bias & Error"],
      ["Methods", "Sampling", "Bias & Error", "Deep"],
      ["Results"],
    ]);
  });
});

describe("buildViewModel type filter", () => {
  const mixed = [
    annotation("h1", ["grp/A"], { type: "highlight" }),
    annotation("u1", ["grp/A"], { type: "underline" }),
    annotation("n1", [], { type: "note" }),
  ];

  it("keeps every type when no filter is given", () => {
    expect(buildViewModel(mixed, PREFIX, {}).totalCount).toBe(3);
    expect(buildViewModel(mixed, PREFIX, { types: [] }).totalCount).toBe(3);
  });

  it("keeps only the requested types, matched case-insensitively", () => {
    const only = buildViewModel(mixed, PREFIX, { types: ["Underline"] });
    expect(only.totalCount).toBe(1);
    expect(only.folders[0].annotationIds).toEqual(["u1"]);
    expect(only.ungrouped).toEqual([]);
  });

  it("filters the ungrouped bucket too, and accepts several types", () => {
    const both = buildViewModel(mixed, PREFIX, { types: ["note", "highlight"] });
    expect(both.totalCount).toBe(2);
    expect(both.ungrouped.map((a) => a.id)).toEqual(["n1"]);
    expect(both.folders[0].annotationIds).toEqual(["h1"]);
  });
});
