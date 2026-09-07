import { describe, expect, it } from "vitest";
import {
  groupsForNewAnnotation,
  newAnnotationDiff,
  pathsForColor,
  resolveColorRules,
} from "../src/core/rules.js";
import type { ColorRule } from "../src/core/types.js";

const library: ColorRule[] = [
  { color: "#FFD400", paths: [["Quotes"], ["Review", "Yellow"]] },
  { color: "#a28ae5", paths: [["Theory"]] },
];

describe("colour rule evaluator", () => {
  it("matches hex codes case-insensitively", () => {
    const resolved = resolveColorRules(library);
    expect(pathsForColor(resolved, "#ffd400")).toEqual([
      ["Quotes"],
      ["Review", "Yellow"],
    ]);
    expect(pathsForColor(resolved, "#FFD400")).toEqual([
      ["Quotes"],
      ["Review", "Yellow"],
    ]);
    expect(pathsForColor(resolved, "  #A28AE5 ")).toEqual([["Theory"]]);
  });

  it("maps one colour to multiple groups additively", () => {
    expect(groupsForNewAnnotation({ color: "#ffd400", libraryRules: library })).toEqual([
      ["Quotes"],
      ["Review", "Yellow"],
    ]);
  });

  it("returns nothing for an unmapped colour", () => {
    expect(groupsForNewAnnotation({ color: "#000000", libraryRules: library })).toEqual(
      [],
    );
  });

  it("lets a per-item rule REPLACE the library rule for that colour only", () => {
    const itemRules: ColorRule[] = [{ color: "#ffd400", paths: [["Chapter 3"]] }];
    const resolved = resolveColorRules(library, itemRules);
    expect(pathsForColor(resolved, "#ffd400")).toEqual([["Chapter 3"]]);
    // untouched colour still falls through to the library rules
    expect(pathsForColor(resolved, "#a28ae5")).toEqual([["Theory"]]);
  });

  it("lets a per-item rule clear a colour with an empty path list", () => {
    const resolved = resolveColorRules(library, [{ color: "#ffd400", paths: [] }]);
    expect(pathsForColor(resolved, "#ffd400")).toEqual([]);
  });

  it("unions the colour rule and the sticky group, sticky last", () => {
    expect(
      groupsForNewAnnotation({
        color: "#a28ae5",
        libraryRules: library,
        stickyPath: ["Session", "Today"],
      }),
    ).toEqual([["Theory"], ["Session", "Today"]]);
  });

  it("deduplicates when the sticky group is also a colour target", () => {
    expect(
      groupsForNewAnnotation({
        color: "#a28ae5",
        libraryRules: library,
        stickyPath: ["Theory"],
      }),
    ).toEqual([["Theory"]]);
  });

  it("never removes an existing membership", () => {
    const result = groupsForNewAnnotation({
      color: "#ffd400",
      existingPaths: [["Manual"]],
      libraryRules: library,
      stickyPath: ["Sticky"],
    });
    expect(result).toEqual([["Manual"], ["Quotes"], ["Review", "Yellow"], ["Sticky"]]);
  });

  it("drops invalid rule targets rather than writing malformed tags", () => {
    const resolved = resolveColorRules([
      { color: "#ffd400", paths: [["a/b"], [], ["1", "2", "3", "4", "5"], ["ok"]] },
    ]);
    expect(pathsForColor(resolved, "#ffd400")).toEqual([["ok"]]);
  });

  it("produces an add-only diff for a new annotation", () => {
    expect(
      newAnnotationDiff("n1", "grp", {
        color: "#ffd400",
        libraryRules: library,
        stickyPath: ["Sticky"],
      }),
    ).toEqual({
      itemId: "n1",
      add: ["grp/Quotes", "grp/Review/Yellow", "grp/Sticky"],
      remove: [],
    });
  });

  it("emits no diff when nothing new applies", () => {
    expect(
      newAnnotationDiff("n1", "grp", { color: "#000000", existingPaths: [["Manual"]] }),
    ).toBeNull();
  });
});
