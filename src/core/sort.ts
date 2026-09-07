/** Deterministic annotation ordering. Pure: no globals, no I/O. */
import type { AnnotationRecord } from "./types.js";

/**
 * Compare two annotations by `annotationSortIndex` — Zotero's zero-padded
 * `page|offset|y` string, so a plain lexicographic compare is document order.
 * Ties break on id so the order is total and stable across runs.
 */
export function compareBySortIndex(a: AnnotationRecord, b: AnnotationRecord): number {
  if (a.sortIndex !== b.sortIndex) {
    return a.sortIndex < b.sortIndex ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/** Copy of `annotations`, ordered by {@link compareBySortIndex}. Input untouched. */
export function sortAnnotations(
  annotations: readonly AnnotationRecord[],
): AnnotationRecord[] {
  return [...annotations].sort(compareBySortIndex);
}

/** Ids of `annotations`, ordered by {@link compareBySortIndex}. */
export function sortIdsBySortIndex(
  ids: readonly string[],
  byId: Readonly<Record<string, AnnotationRecord>>,
): string[] {
  return [...ids].sort((left, right) => {
    const a = byId[left];
    const b = byId[right];
    if (a === undefined || b === undefined) {
      return left < right ? -1 : left > right ? 1 : 0;
    }
    return compareBySortIndex(a, b);
  });
}
