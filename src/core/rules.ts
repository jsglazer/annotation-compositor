/**
 * Colour rules and sticky-group resolution for newly created annotations.
 * Pure: no globals, no I/O.
 *
 * Rules fire at annotation-creation time only and are never re-applied
 * retroactively to existing annotations.
 */
import { formatTag, pathKey, validatePath } from "./path.js";
import type { ColorRule, FolderPath, TagDiffEntry } from "./types.js";

/** Canonical colour key: trimmed, lower-cased. Matching is case-insensitive. */
export function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

/**
 * Resolve the effective rule set for one item.
 *
 * Resolution is per colour, not per rule set: a per-item rule for a given hex
 * REPLACES the library-wide rule for that hex, while colours with no per-item
 * rule fall through to the library rules.
 */
export function resolveColorRules(
  libraryRules: readonly ColorRule[],
  itemRules: readonly ColorRule[] = [],
): Map<string, FolderPath[]> {
  const resolved = new Map<string, FolderPath[]>();
  const put = (rule: ColorRule): void => {
    const key = normalizeColor(rule.color);
    if (key.length === 0) {
      return;
    }
    const paths: FolderPath[] = [];
    const seen = new Set<string>();
    for (const path of rule.paths) {
      const check = validatePath(path);
      if (!check.ok || check.value === undefined) {
        continue;
      }
      const id = pathKey(check.value);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      paths.push(check.value);
    }
    resolved.set(key, paths);
  };
  for (const rule of libraryRules) {
    put(rule);
  }
  for (const rule of itemRules) {
    put(rule); // per-item wins for this colour, wholesale
  }
  return resolved;
}

/** Folder paths a colour maps to under the resolved rules. Empty when unmapped. */
export function pathsForColor(
  resolved: ReadonlyMap<string, FolderPath[]>,
  color: string,
): FolderPath[] {
  return resolved.get(normalizeColor(color)) ?? [];
}

export interface NewAnnotationContext {
  /** Colour of the annotation just created. */
  readonly color: string;
  /** Group paths the annotation already carries (normally none). */
  readonly existingPaths?: readonly FolderPath[];
  readonly libraryRules?: readonly ColorRule[];
  readonly itemRules?: readonly ColorRule[];
  /** Folder pinned to the reader tab, or `null` when no sticky group is set. */
  readonly stickyPath?: FolderPath | null;
}

/**
 * Group membership for a newly created annotation: the deduplicated union of
 * existing memberships, colour-rule targets, and the sticky group applied last.
 * Neither mechanism may ever remove an existing membership, so the result is
 * always a superset of `existingPaths`.
 */
export function groupsForNewAnnotation(ctx: NewAnnotationContext): FolderPath[] {
  const resolved = resolveColorRules(ctx.libraryRules ?? [], ctx.itemRules ?? []);
  const ordered: FolderPath[] = [];
  const seen = new Set<string>();
  const push = (path: FolderPath): void => {
    const check = validatePath(path);
    if (!check.ok || check.value === undefined) {
      return;
    }
    const key = pathKey(check.value);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push(check.value);
  };

  for (const path of ctx.existingPaths ?? []) {
    push(path);
  }
  for (const path of pathsForColor(resolved, ctx.color)) {
    push(path);
  }
  // Sticky group applied last.
  if (ctx.stickyPath !== undefined && ctx.stickyPath !== null) {
    push(ctx.stickyPath);
  }
  return ordered;
}

/**
 * The add-only tag diff for a newly created annotation. Additive by
 * construction: `remove` is always empty.
 */
export function newAnnotationDiff(
  itemId: string,
  prefix: string,
  ctx: NewAnnotationContext,
): TagDiffEntry | null {
  const existing = new Set(
    (ctx.existingPaths ?? []).map((path) => formatTag(prefix, path)),
  );
  const add = groupsForNewAnnotation(ctx)
    .map((path) => formatTag(prefix, path))
    .filter((tag) => !existing.has(tag))
    .sort();
  return add.length === 0 ? null : { itemId, add, remove: [] };
}
