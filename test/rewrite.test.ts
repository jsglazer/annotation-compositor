import { describe, expect, it } from "vitest";
import {
  assignAnnotations,
  collectGroupTagsByItem,
  countMutations,
  deleteFolder,
  migratePrefix,
  renameFolder,
  reparentFolder,
  unassignAnnotations,
} from "../src/core/rewrite.js";
import type { RewriteResult } from "../src/core/rewrite.js";
import type { TagDiffEntry } from "../src/core/types.js";
import { PREFIX, annotation, sampleAnnotations } from "./fixtures.js";

function diffOf(result: RewriteResult): readonly TagDiffEntry[] {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error}`);
  }
  return result.diff;
}

describe("path rewrite engine", () => {
  it("renames a root folder across its whole subtree", () => {
    const diff = diffOf(renameFolder(sampleAnnotations(), PREFIX, ["Methods"], "Design"));
    expect(diff).toEqual([
      {
        itemId: "a1",
        add: ["grp/Design", "grp/Design/Sampling"],
        remove: ["grp/Methods", "grp/Methods/Sampling"],
      },
      {
        itemId: "a2",
        add: ["grp/Design/Sampling/Bias & Error"],
        remove: ["grp/Methods/Sampling/Bias & Error"],
      },
      {
        itemId: "a3",
        add: ["grp/Design/Sampling/Bias & Error/Deep"],
        remove: ["grp/Methods/Sampling/Bias & Error/Deep"],
      },
      { itemId: "a4", add: ["grp/Design"], remove: ["grp/Methods"] },
    ]);
    expect(countMutations(diff)).toBe(10);
  });

  it("renames an intermediate folder and touches nothing above it", () => {
    const diff = diffOf(
      renameFolder(sampleAnnotations(), PREFIX, ["Methods", "Sampling"], "Sample"),
    );
    expect(diff.map((entry) => entry.itemId)).toEqual(["a1", "a2", "a3"]);
    expect(diff[0]).toEqual({
      itemId: "a1",
      add: ["grp/Methods/Sample"],
      remove: ["grp/Methods/Sampling"],
    });
  });

  it("renames a leaf folder with a minimal diff", () => {
    const diff = diffOf(
      renameFolder(
        sampleAnnotations(),
        PREFIX,
        ["Methods", "Sampling", "Bias & Error", "Deep"],
        "Deeper",
      ),
    );
    expect(diff).toEqual([
      {
        itemId: "a3",
        add: ["grp/Methods/Sampling/Bias & Error/Deeper"],
        remove: ["grp/Methods/Sampling/Bias & Error/Deep"],
      },
    ]);
  });

  it("emits an empty diff for a no-op rename", () => {
    expect(
      diffOf(renameFolder(sampleAnnotations(), PREFIX, ["Methods"], "Methods")),
    ).toEqual([]);
  });

  it("rejects a rename that reintroduces the separator", () => {
    const result = renameFolder(sampleAnnotations(), PREFIX, ["Methods"], "A/B");
    expect(result.ok).toBe(false);
  });

  it("reparents a folder and its subtree", () => {
    const diff = diffOf(
      reparentFolder(sampleAnnotations(), PREFIX, ["Methods", "Sampling"], ["Results"]),
    );
    expect(diff).toEqual([
      { itemId: "a1", add: ["grp/Results/Sampling"], remove: ["grp/Methods/Sampling"] },
      {
        itemId: "a2",
        add: ["grp/Results/Sampling/Bias & Error"],
        remove: ["grp/Methods/Sampling/Bias & Error"],
      },
      {
        itemId: "a3",
        add: ["grp/Results/Sampling/Bias & Error/Deep"],
        remove: ["grp/Methods/Sampling/Bias & Error/Deep"],
      },
    ]);
  });

  it("reparents to the top level", () => {
    const diff = diffOf(
      reparentFolder(sampleAnnotations(), PREFIX, ["Methods", "Sampling"], []),
    );
    expect(diff[0]).toEqual({
      itemId: "a1",
      add: ["grp/Sampling"],
      remove: ["grp/Methods/Sampling"],
    });
  });

  it("refuses to move a folder into its own subtree", () => {
    const result = reparentFolder(
      sampleAnnotations(),
      PREFIX,
      ["Methods"],
      ["Methods", "Sampling"],
    );
    expect(result).toEqual({
      ok: false,
      error: "A folder cannot be moved into itself or one of its own subfolders.",
    });
  });

  it("refuses a move that would exceed the depth cap", () => {
    const result = reparentFolder(
      sampleAnnotations(),
      PREFIX,
      ["Methods", "Sampling"],
      ["Results", "X"],
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("4 levels deep");
  });

  it("deletes a folder subtree without deleting annotations", () => {
    const diff = diffOf(
      deleteFolder(sampleAnnotations(), PREFIX, ["Methods", "Sampling"]),
    );
    expect(diff).toEqual([
      { itemId: "a1", add: [], remove: ["grp/Methods/Sampling"] },
      { itemId: "a2", add: [], remove: ["grp/Methods/Sampling/Bias & Error"] },
      { itemId: "a3", add: [], remove: ["grp/Methods/Sampling/Bias & Error/Deep"] },
    ]);
  });

  it("never emits foreign tags in a diff", () => {
    const diff = diffOf(renameFolder(sampleAnnotations(), PREFIX, ["Methods"], "Design"));
    const all = diff.flatMap((entry) => [...entry.add, ...entry.remove]);
    expect(all.some((tag) => tag === "keep-me" || tag === "unrelated")).toBe(false);
  });

  it("never mentions the derived Ungrouped bucket", () => {
    const diff = diffOf(deleteFolder(sampleAnnotations(), PREFIX, ["Methods"]));
    expect(diff.map((entry) => entry.itemId)).not.toContain("a5");
    expect(JSON.stringify(diff)).not.toContain("Ungrouped");
  });

  it("does not mutate its input", () => {
    const annotations = sampleAnnotations();
    const before = JSON.stringify(annotations);
    renameFolder(annotations, PREFIX, ["Methods"], "Design");
    reparentFolder(annotations, PREFIX, ["Methods"], []);
    deleteFolder(annotations, PREFIX, ["Methods"]);
    expect(JSON.stringify(annotations)).toBe(before);
  });
});

describe("assignment", () => {
  it("drag MOVES: adds the destination and removes the source in one entry", () => {
    const diff = diffOf(
      assignAnnotations(sampleAnnotations(), PREFIX, ["a1"], ["Results"], {
        mode: "move",
        sourcePath: ["Methods"],
      }),
    );
    expect(diff).toEqual([
      { itemId: "a1", add: ["grp/Results"], remove: ["grp/Methods"] },
    ]);
  });

  it("command-drag ADDS without removing", () => {
    const diff = diffOf(
      assignAnnotations(sampleAnnotations(), PREFIX, ["a1"], ["Results"], {
        mode: "add",
      }),
    );
    expect(diff).toEqual([{ itemId: "a1", add: ["grp/Results"], remove: [] }]);
  });

  it("dragging out of Ungrouped is always an add", () => {
    const diff = diffOf(
      assignAnnotations(sampleAnnotations(), PREFIX, ["a5"], ["Results"], {
        mode: "move",
      }),
    );
    expect(diff).toEqual([{ itemId: "a5", add: ["grp/Results"], remove: [] }]);
  });

  it("is a no-op when the destination is the source", () => {
    expect(
      diffOf(
        assignAnnotations(sampleAnnotations(), PREFIX, ["a1"], ["Methods"], {
          mode: "move",
          sourcePath: ["Methods"],
        }),
      ),
    ).toEqual([]);
  });

  it("removes one membership without touching descendants", () => {
    const diff = diffOf(
      unassignAnnotations(sampleAnnotations(), PREFIX, ["a1"], ["Methods"]),
    );
    expect(diff).toEqual([{ itemId: "a1", add: [], remove: ["grp/Methods"] }]);
  });
});

describe("prefix migration and tag-type rewrite", () => {
  it("rewrites every group tag to the new prefix", () => {
    const diff = diffOf(migratePrefix(sampleAnnotations(), "grp", "folder"));
    expect(diff[0]).toEqual({
      itemId: "a1",
      add: ["folder/Methods", "folder/Methods/Sampling"],
      remove: ["grp/Methods", "grp/Methods/Sampling"],
    });
    expect(diff.map((e) => e.itemId)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("collects the group tags a tag-type switch must rewrite", () => {
    expect(collectGroupTagsByItem([annotation("x", ["grp/A", "other"])], PREFIX)).toEqual(
      [{ itemId: "x", tags: ["grp/A"] }],
    );
  });
});
