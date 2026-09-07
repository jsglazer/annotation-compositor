import type { AnnotationRecord } from "../src/core/types.js";

export const PREFIX = "grp";

/** Build an annotation record; every field has a deterministic default. */
export function annotation(
  id: string,
  tags: readonly string[] = [],
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id,
    type: "highlight",
    color: "#ffd400",
    text: `text-${id}`,
    comment: "",
    pageLabel: "1",
    sortIndex: `00001|000000|0000${id.length}`,
    tags,
    dateModified: "2026-01-01T00:00:00Z",
    authorName: "",
    ...overrides,
  };
}

/**
 * A small library exercising multi-membership, 3+ levels of nesting, special
 * characters in folder names, foreign tags, and an ungrouped annotation.
 */
export function sampleAnnotations(): AnnotationRecord[] {
  return [
    annotation("a1", ["grp/Methods", "grp/Methods/Sampling", "keep-me"], {
      sortIndex: "00001|000010|00010",
      color: "#FFD400",
    }),
    annotation("a2", ["grp/Methods/Sampling/Bias & Error"], {
      sortIndex: "00001|000020|00010",
      color: "#a28ae5",
    }),
    annotation("a3", ["grp/Methods/Sampling/Bias & Error/Deep"], {
      sortIndex: "00002|000005|00010",
      color: "#5fb236",
    }),
    // multi-membership: two unrelated branches
    annotation("a4", ["grp/Results", "grp/Methods"], {
      sortIndex: "00000|000001|00001",
      color: "#ff6666",
    }),
    // ungrouped: a foreign tag only
    annotation("a5", ["unrelated"], { sortIndex: "00003|000001|00001" }),
  ];
}
