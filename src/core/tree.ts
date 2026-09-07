/**
 * Tree derivation: flat annotation records -> folder view model.
 * Pure: no globals, no I/O, no DOM. Input arrays are never mutated.
 */
import { comparePaths, groupPaths, keyToPath, pathKey, validatePath } from "./path.js";
import { sortIdsBySortIndex } from "./sort.js";
import type {
  AnnotationRecord,
  FolderNode,
  FolderPath,
  PanelViewModel,
  UiState,
} from "./types.js";

interface MutableNode {
  name: string;
  path: string[];
  key: string;
  annotationIds: Set<string>;
  children: Map<string, MutableNode>;
}

function makeNode(name: string, path: string[]): MutableNode {
  return {
    name,
    path,
    key: pathKey(path),
    annotationIds: new Set<string>(),
    children: new Map<string, MutableNode>(),
  };
}

function ensurePath(roots: Map<string, MutableNode>, segments: FolderPath): MutableNode {
  let level = roots;
  let node: MutableNode | undefined;
  const walked: string[] = [];
  for (const segment of segments) {
    walked.push(segment);
    let next = level.get(segment);
    if (next === undefined) {
      next = makeNode(segment, [...walked]);
      level.set(segment, next);
    }
    node = next;
    level = next.children;
  }
  // `segments` is never empty here: callers filter empty paths out first.
  return node as MutableNode;
}

function matchesFilter(
  annotation: AnnotationRecord,
  paths: readonly FolderPath[],
  needle: string,
): boolean {
  if (needle.length === 0) {
    return true;
  }
  if (annotation.text.toLowerCase().includes(needle)) {
    return true;
  }
  if (annotation.comment.toLowerCase().includes(needle)) {
    return true;
  }
  for (const path of paths) {
    for (const segment of path) {
      if (segment.toLowerCase().includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

interface Freeze {
  readonly collapsed: ReadonlySet<string>;
  readonly byId: Readonly<Record<string, AnnotationRecord>>;
}

/** Depth-first freeze into the readonly view model, collecting subtree rollups. */
function freezeNode(
  node: MutableNode,
  ctx: Freeze,
): { node: FolderNode; ids: Set<string>; colors: Set<string> } {
  const subtreeIds = new Set<string>(node.annotationIds);
  const colors = new Set<string>();
  for (const id of node.annotationIds) {
    const annotation = ctx.byId[id];
    if (annotation !== undefined) {
      colors.add(annotation.color.toLowerCase());
    }
  }

  const childNodes: FolderNode[] = [];
  const orderedChildren = [...node.children.values()].sort((a, b) =>
    comparePaths(a.path, b.path),
  );
  for (const child of orderedChildren) {
    const frozen = freezeNode(child, ctx);
    childNodes.push(frozen.node);
    for (const id of frozen.ids) {
      subtreeIds.add(id);
    }
    for (const color of frozen.colors) {
      colors.add(color);
    }
  }

  const collapsed = ctx.collapsed.has(node.key);
  const frozenNode: FolderNode = {
    name: node.name,
    path: [...node.path],
    key: node.key,
    annotationIds: sortIdsBySortIndex([...node.annotationIds], ctx.byId),
    directCount: node.annotationIds.size,
    totalCount: subtreeIds.size,
    hasChildren: node.children.size > 0,
    collapsed,
    colors: [...colors].sort(),
    // A collapsed subtree is not rendered at all — it is not built into the
    // view model, so the DOM swap never sees it.
    children: collapsed ? [] : childNodes,
  };
  return { node: frozenNode, ids: subtreeIds, colors };
}

/**
 * Build the whole panel view model.
 *
 * `Ungrouped` is derived here from the absence of any prefixed tag. It is a
 * bucket in the view model only: it is never written as a tag and never
 * appears in a tag diff.
 */
export function buildViewModel(
  annotations: readonly AnnotationRecord[],
  tagPrefix: string,
  uiState: UiState = {},
): PanelViewModel {
  const needle = (uiState.filter ?? "").trim().toLowerCase();
  const collapsed = new Set(uiState.collapsedKeys ?? []);

  const roots = new Map<string, MutableNode>();
  const byId: Record<string, AnnotationRecord> = {};
  const ungrouped: AnnotationRecord[] = [];
  let totalCount = 0;

  for (const annotation of annotations) {
    const paths = groupPaths(annotation.tags, tagPrefix);
    if (!matchesFilter(annotation, paths, needle)) {
      continue;
    }
    byId[annotation.id] = annotation;
    totalCount += 1;
    if (paths.length === 0) {
      ungrouped.push(annotation);
      continue;
    }
    const seen = new Set<string>();
    for (const path of paths) {
      const key = pathKey(path);
      if (seen.has(key)) {
        continue; // duplicate tag on the same annotation
      }
      seen.add(key);
      ensurePath(roots, path).annotationIds.add(annotation.id);
    }
  }

  // Folders the user created that hold no annotation yet cannot exist as tags,
  // so they are carried in UI state and merged in here.
  for (const key of uiState.pendingFolderKeys ?? []) {
    const segments = keyToPath(key);
    if (validatePath(segments).ok) {
      ensurePath(roots, segments);
    }
  }

  const ctx: Freeze = { collapsed, byId };
  const folders = [...roots.values()]
    .sort((a, b) => comparePaths(a.path, b.path))
    .map((node) => freezeNode(node, ctx).node);

  ungrouped.sort((a, b) =>
    a.sortIndex === b.sortIndex
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.sortIndex < b.sortIndex
        ? -1
        : 1,
  );

  return { folders, ungrouped, annotationsById: byId, totalCount };
}

/** Every folder key present in the model, in stable depth-first order. */
export function collectFolderKeys(folders: readonly FolderNode[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: readonly FolderNode[]): void => {
    for (const node of nodes) {
      keys.push(node.key);
      walk(node.children);
    }
  };
  walk(folders);
  return keys;
}

/**
 * Every distinct folder path that exists as a tag on `annotations`, including
 * the implied ancestors of deeper paths. Used by the context menu and pickers.
 */
export function collectExistingPaths(
  annotations: readonly AnnotationRecord[],
  tagPrefix: string,
): string[][] {
  const keys = new Set<string>();
  for (const annotation of annotations) {
    for (const path of groupPaths(annotation.tags, tagPrefix)) {
      for (let depth = 1; depth <= path.length; depth += 1) {
        keys.add(pathKey(path.slice(0, depth)));
      }
    }
  }
  return [...keys].map(keyToPath).sort(comparePaths);
}
