import { describe, expect, it } from "vitest";
import { buildExportContext } from "../src/core/exportModel.js";
import { PREFIX, annotation, sampleAnnotations } from "./fixtures.js";

describe("export model", () => {
  it("renders an annotation once per selected folder it belongs to", () => {
    const context = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [["Methods"], ["Results"]],
      includeSubfolders: false,
    });
    const ids = context.folders.flatMap((folder) => folder.annotations.map((a) => a.id));
    expect(ids.filter((id) => id === "a4")).toHaveLength(2); // intended duplicate
  });

  it("orders every folder by annotationSortIndex and numbers from 1", () => {
    const annotations = [
      annotation("b", ["grp/A"], { sortIndex: "00002|000000|00000" }),
      annotation("a", ["grp/A"], { sortIndex: "00001|000000|00000" }),
    ];
    const context = buildExportContext(annotations, PREFIX, { selectedPaths: [["A"]] });
    expect(context.folders[0].annotations.map((a) => [a.id, a.index])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("nests subfolders when asked and flattens them out when not", () => {
    const nested = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [["Methods"]],
      includeSubfolders: true,
    });
    expect(nested.folders[0].folders[0].key).toBe("Methods/Sampling");
    // 5, not 4: a1 is tagged both Methods and Methods/Sampling, and export
    // counts rendered occurrences — duplicates across folders are intended.
    expect(nested.folders[0].totalCount).toBe(5);

    const flat = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [["Methods"]],
      includeSubfolders: false,
    });
    expect(flat.folders[0].folders).toEqual([]);
    expect(flat.folders[0].totalCount).toBe(2);
  });

  it("drops a selected folder already covered by a selected ancestor", () => {
    const context = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [["Methods"], ["Methods", "Sampling"]],
      includeSubfolders: true,
    });
    expect(context.folders.map((folder) => folder.key)).toEqual(["Methods"]);
  });

  it("includes the derived Ungrouped bucket only on request", () => {
    const off = buildExportContext(sampleAnnotations(), PREFIX, { selectedPaths: [] });
    expect(off.hasUngrouped).toBe(false);
    const on = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [],
      includeUngrouped: true,
    });
    expect(on.ungrouped.map((a) => a.id)).toEqual(["a5"]);
  });
});
