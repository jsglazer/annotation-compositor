/**
 * Tag-path rewrite engine: folder operations -> minimal tag diffs.
 * Pure: no globals, no I/O. Input arrays are never mutated.
 *
 * Every operation returns a `TagDiffEntry[]` covering only the annotations that
 * actually change; each entry's `add`/`remove` lists are disjoint, deduplicated
 * and sorted, so equivalent operations produce byte-identical diffs.
 */
import {
  MAX_DEPTH,
  comparePaths,
  formatTag,
  groupPaths,
  isAtOrBelow,
  parseTag,
  pathKey,
  validateFolderName,
  validatePath,
} from "./path.js";
import type { AnnotationRecord, FolderPath, TagDiffEntry } from "./types.js";

export type RewriteResult =
  | { readonly ok: true; readonly diff: readonly TagDiffEntry[] }
  | { readonly ok: false; readonly error: string };

function success(diff: TagDiffEntry[]): RewriteResult {
  return { ok: true, diff };
}

function failure(error: string): RewriteResult {
  return { ok: false, error };
}

/**
 * Core diff primitive: rewrite each annotation's group-tag set with `mapPath`
 * and emit the minimal add/remove pair. `mapPath` returns the replacement
 * paths for one existing path (`[]` deletes it, the same path keeps it).
 */
function diffByPathMap(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  mapPath: (path: FolderPath) => FolderPath[],
): TagDiffEntry[] {
  const entries: TagDiffEntry[] = [];
  for (const annotation of annotations) {
    const current = new Set<string>();
    for (const tag of annotation.tags) {
      if (parseTag(tag, prefix) !== null) {
        current.add(tag);
      }
    }
    if (current.size === 0) {
      continue;
    }
    const desired = new Set<string>();
    for (const path of groupPaths(annotation.tags, prefix)) {
      for (const mapped of mapPath(path)) {
        desired.add(formatTag(prefix, mapped));
      }
    }
    const entry = makeEntry(annotation.id, current, desired);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function makeEntry(
  itemId: string,
  current: ReadonlySet<string>,
  desired: ReadonlySet<string>,
): TagDiffEntry | null {
  const add: string[] = [];
  const remove: string[] = [];
  for (const tag of desired) {
    if (!current.has(tag)) {
      add.push(tag);
    }
  }
  for (const tag of current) {
    if (!desired.has(tag)) {
      remove.push(tag);
    }
  }
  if (add.length === 0 && remove.length === 0) {
    return null;
  }
  add.sort();
  remove.sort();
  return { itemId, add, remove };
}

/** Depth check for a whole subtree after a reparent. */
function deepestUnder(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  root: FolderPath,
): number {
  let deepest = root.length;
  for (const annotation of annotations) {
    for (const path of groupPaths(annotation.tags, prefix)) {
      if (isAtOrBelow(path, root) && path.length > deepest) {
        deepest = path.length;
      }
    }
  }
  return deepest;
}

/**
 * Rename a folder in place. Root, intermediate and leaf folders are all handled
 * by the same subtree rewrite: every path at or below `path` gets its
 * `path.length - 1`-th segment replaced.
 */
export function renameFolder(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  path: FolderPath,
  newName: string,
): RewriteResult {
  const pathCheck = validatePath(path);
  if (!pathCheck.ok || pathCheck.value === undefined) {
    return failure(pathCheck.error ?? "Invalid folder path.");
  }
  const nameCheck = validateFolderName(newName);
  if (!nameCheck.ok || nameCheck.value === undefined) {
    return failure(nameCheck.error ?? "Invalid folder name.");
  }
  const source = pathCheck.value;
  const name = nameCheck.value;
  if (source[source.length - 1] === name) {
    return success([]);
  }
  const target = [...source.slice(0, -1), name];
  return success(
    diffByPathMap(annotations, prefix, (candidate) =>
      isAtOrBelow(candidate, source)
        ? [[...target, ...candidate.slice(source.length)]]
        : [candidate],
    ),
  );
}

/**
 * Reparent a folder and its whole subtree under `newParent` (`[]` = top level).
 * Rejects reparenting into the folder's own subtree and any move that would
 * push a descendant past `MAX_DEPTH`.
 */
export function reparentFolder(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  path: FolderPath,
  newParent: FolderPath,
): RewriteResult {
  const pathCheck = validatePath(path);
  if (!pathCheck.ok || pathCheck.value === undefined) {
    return failure(pathCheck.error ?? "Invalid folder path.");
  }
  const source = pathCheck.value;
  let parent: string[] = [];
  if (newParent.length > 0) {
    const parentCheck = validatePath(newParent);
    if (!parentCheck.ok || parentCheck.value === undefined) {
      return failure(parentCheck.error ?? "Invalid destination folder.");
    }
    parent = parentCheck.value;
  }
  if (isAtOrBelow(parent, source)) {
    return failure("A folder cannot be moved into itself or one of its own subfolders.");
  }
  const target = [...parent, source[source.length - 1]];
  if (pathKey(target) === pathKey(source)) {
    return success([]);
  }
  const depthAfterMove =
    deepestUnder(annotations, prefix, source) - source.length + target.length;
  if (depthAfterMove > MAX_DEPTH) {
    return failure(`This move would nest folders more than ${MAX_DEPTH} levels deep.`);
  }
  return success(
    diffByPathMap(annotations, prefix, (candidate) =>
      isAtOrBelow(candidate, source)
        ? [[...target, ...candidate.slice(source.length)]]
        : [candidate],
    ),
  );
}

/**
 * Delete a folder and every folder below it. Annotations are not deleted — they
 * lose the membership and fall back into the derived `Ungrouped` bucket if this
 * was their last group tag.
 */
export function deleteFolder(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  path: FolderPath,
): RewriteResult {
  const pathCheck = validatePath(path);
  if (!pathCheck.ok || pathCheck.value === undefined) {
    return failure(pathCheck.error ?? "Invalid folder path.");
  }
  const source = pathCheck.value;
  return success(
    diffByPathMap(annotations, prefix, (candidate) =>
      isAtOrBelow(candidate, source) ? [] : [candidate],
    ),
  );
}

export type AssignMode = "add" | "move";

/**
 * Assign annotations to `target`.
 *
 * `add` adds the destination membership and removes nothing. `move` also
 * removes `sourcePath` — the folder the drag started in. Dragging out of the
 * derived `Ungrouped` bucket has no source tag to remove, so it is always an
 * add: pass no `sourcePath`.
 */
export function assignAnnotations(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  annotationIds: readonly string[],
  target: FolderPath,
  options: { readonly mode: AssignMode; readonly sourcePath?: FolderPath } = {
    mode: "add",
  },
): RewriteResult {
  const targetCheck = validatePath(target);
  if (!targetCheck.ok || targetCheck.value === undefined) {
    return failure(targetCheck.error ?? "Invalid destination folder.");
  }
  const destination = targetCheck.value;
  const destinationTag = formatTag(prefix, destination);
  const source = options.sourcePath;
  if (options.mode === "move" && source !== undefined && source.length > 0) {
    const sourceCheck = validatePath(source);
    if (!sourceCheck.ok) {
      return failure(sourceCheck.error ?? "Invalid source folder.");
    }
    if (pathKey(source) === pathKey(destination)) {
      return success([]);
    }
  }
  const wanted = new Set(annotationIds);
  const removeSource =
    options.mode === "move" && source !== undefined && source.length > 0
      ? formatTag(prefix, source)
      : null;

  const entries: TagDiffEntry[] = [];
  for (const annotation of annotations) {
    if (!wanted.has(annotation.id)) {
      continue;
    }
    const current = new Set<string>();
    for (const tag of annotation.tags) {
      if (parseTag(tag, prefix) !== null) {
        current.add(tag);
      }
    }
    const desired = new Set(current);
    desired.add(destinationTag);
    if (removeSource !== null) {
      desired.delete(removeSource);
    }
    const entry = makeEntry(annotation.id, current, desired);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return success(entries);
}

/** Remove annotations from exactly one folder, leaving descendants alone. */
export function unassignAnnotations(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  annotationIds: readonly string[],
  path: FolderPath,
): RewriteResult {
  const pathCheck = validatePath(path);
  if (!pathCheck.ok || pathCheck.value === undefined) {
    return failure(pathCheck.error ?? "Invalid folder path.");
  }
  const tag = formatTag(prefix, pathCheck.value);
  const wanted = new Set(annotationIds);
  const entries: TagDiffEntry[] = [];
  for (const annotation of annotations) {
    if (!wanted.has(annotation.id) || !annotation.tags.includes(tag)) {
      continue;
    }
    entries.push({ itemId: annotation.id, add: [], remove: [tag] });
  }
  return success(entries);
}

/**
 * Rewrite every group tag from `oldPrefix` to `newPrefix`. Used by the
 * confirm-gated, snapshot-backed prefix migration; the reader never accepts two
 * prefixes at once, so this is all-or-nothing.
 */
export function migratePrefix(
  annotations: readonly AnnotationRecord[],
  oldPrefix: string,
  newPrefix: string,
): RewriteResult {
  if (oldPrefix === newPrefix) {
    return success([]);
  }
  const entries: TagDiffEntry[] = [];
  for (const annotation of annotations) {
    const remove: string[] = [];
    const add: string[] = [];
    for (const tag of annotation.tags) {
      const parsed = parseTag(tag, oldPrefix);
      if (parsed === null) {
        continue;
      }
      remove.push(tag);
      add.push(formatTag(newPrefix, parsed));
    }
    if (remove.length === 0) {
      continue;
    }
    entries.push({
      itemId: annotation.id,
      add: [...new Set(add)].sort(),
      remove: [...new Set(remove)].sort(),
    });
  }
  return entries.length === 0 ? success([]) : success(entries);
}

/**
 * Every group tag currently on the given annotations, per item, sorted. The tag
 * writer uses this to re-write each tag with a different tag type (manual <->
 * automatic) without changing a single path.
 */
export function collectGroupTagsByItem(
  annotations: readonly AnnotationRecord[],
  prefix: string,
): { readonly itemId: string; readonly tags: readonly string[] }[] {
  const out: { itemId: string; tags: string[] }[] = [];
  for (const annotation of annotations) {
    const tags = annotation.tags.filter((tag) => parseTag(tag, prefix) !== null);
    if (tags.length > 0) {
      out.push({ itemId: annotation.id, tags: [...new Set(tags)].sort() });
    }
  }
  return out;
}

/** Stable ordering for a diff, so log output and tests compare byte-for-byte. */
export function sortDiff(diff: readonly TagDiffEntry[]): TagDiffEntry[] {
  return [...diff].sort((a, b) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
  );
}

/** Total tag mutations in a diff — shown in the confirmation and restore preview. */
export function countMutations(diff: readonly TagDiffEntry[]): number {
  return diff.reduce((total, entry) => total + entry.add.length + entry.remove.length, 0);
}

export { comparePaths };
