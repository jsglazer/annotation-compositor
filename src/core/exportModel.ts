/**
 * Export view model: annotations + selected folders -> a plain template context.
 * Pure: no globals, no I/O.
 *
 * An annotation is rendered once per selected folder it belongs to; duplicates
 * across folders are intended output. Ordering inside every folder is by
 * `annotationSortIndex`.
 */
import { comparePaths, groupPaths, isBelow, pathKey } from "./path.js";
import { resolveColorLabel } from "./colorNames.js";
import { sortAnnotations } from "./sort.js";
import { collectExistingPaths } from "./tree.js";
import type { AnnotationRecord, FolderPath } from "./types.js";

export interface ExportAnnotation {
  readonly id: string;
  readonly index: number;
  readonly type: string;
  readonly color: string;
  /** Display label for `color` — a custom label when one is set, else the built-in name. */
  readonly colorLabel: string;
  readonly text: string;
  readonly comment: string;
  readonly pageLabel: string;
  readonly sortIndex: string;
  readonly dateModified: string;
  readonly authorName: string;
  readonly hasText: boolean;
  readonly hasComment: boolean;
  readonly tags: readonly string[];
}

export interface ExportFolder {
  readonly name: string;
  readonly path: string;
  readonly key: string;
  readonly depth: number;
  readonly count: number;
  readonly totalCount: number;
  readonly annotations: readonly ExportAnnotation[];
  readonly folders: readonly ExportFolder[];
  readonly hasAnnotations: boolean;
  readonly hasFolders: boolean;
}

export interface ExportContext extends Record<string, unknown> {
  readonly title: string;
  readonly folders: readonly ExportFolder[];
  readonly ungrouped: readonly ExportAnnotation[];
  readonly hasUngrouped: boolean;
  readonly totalCount: number;
}

export interface ExportOptions {
  /** Folder paths the user ticked. */
  readonly selectedPaths: readonly FolderPath[];
  /** Nest each selected folder's descendants under it. */
  readonly includeSubfolders?: boolean;
  /** Add the derived `Ungrouped` bucket as a top-level list. */
  readonly includeUngrouped?: boolean;
  /** Parent item title, passed through to the template. */
  readonly title?: string;
  /** Custom color labels (e.g. from Enhanced Notes), keyed by canonical color name. */
  readonly colorLabels?: Readonly<Record<string, string>>;
}

function toExportAnnotation(
  annotation: AnnotationRecord,
  index: number,
  colorLabels: Readonly<Record<string, string>>,
): ExportAnnotation {
  return {
    id: annotation.id,
    index,
    type: annotation.type,
    color: annotation.color,
    colorLabel: resolveColorLabel(annotation.color, colorLabels),
    text: annotation.text,
    comment: annotation.comment,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    dateModified: annotation.dateModified,
    authorName: annotation.authorName,
    hasText: annotation.text.length > 0,
    hasComment: annotation.comment.length > 0,
    tags: [...annotation.tags],
  };
}

/** Build the template context. Input arrays are never mutated. */
export function buildExportContext(
  annotations: readonly AnnotationRecord[],
  tagPrefix: string,
  options: ExportOptions,
): ExportContext {
  const membership = new Map<string, AnnotationRecord[]>();
  const ungroupedRecords: AnnotationRecord[] = [];
  for (const annotation of annotations) {
    const paths = groupPaths(annotation.tags, tagPrefix);
    if (paths.length === 0) {
      ungroupedRecords.push(annotation);
      continue;
    }
    const seen = new Set<string>();
    for (const path of paths) {
      const key = pathKey(path);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const bucket = membership.get(key);
      if (bucket === undefined) {
        membership.set(key, [annotation]);
      } else {
        bucket.push(annotation);
      }
    }
  }

  const includeSubfolders = options.includeSubfolders ?? true;
  const colorLabels = options.colorLabels ?? {};
  const knownPaths = collectExistingPaths(annotations, tagPrefix);

  // Deduplicate the selection, and when subfolders are included drop any
  // selected path already covered by a selected ancestor.
  const selectionKeys = new Set(options.selectedPaths.map(pathKey));
  const roots = options.selectedPaths
    .filter(
      (path, position) =>
        options.selectedPaths.findIndex((p) => pathKey(p) === pathKey(path)) === position,
    )
    .filter((path) => {
      if (!includeSubfolders) {
        return true;
      }
      for (const key of selectionKeys) {
        const other = key.length === 0 ? [] : key.split("/");
        if (isBelow(path, other)) {
          return false;
        }
      }
      return true;
    })
    .sort(comparePaths);

  const buildFolder = (path: FolderPath): ExportFolder => {
    const key = pathKey(path);
    const own = sortAnnotations(membership.get(key) ?? []);
    const children: ExportFolder[] = includeSubfolders
      ? knownPaths
          .filter(
            (candidate) =>
              candidate.length === path.length + 1 && isBelow(candidate, path),
          )
          .sort(comparePaths)
          .map(buildFolder)
      : [];
    const totalCount =
      own.length + children.reduce((sum, child) => sum + child.totalCount, 0);
    return {
      name: path.length === 0 ? "" : path[path.length - 1],
      path: key,
      key,
      depth: path.length,
      count: own.length,
      totalCount,
      annotations: own.map((annotation, index) =>
        toExportAnnotation(annotation, index + 1, colorLabels),
      ),
      folders: children,
      hasAnnotations: own.length > 0,
      hasFolders: children.length > 0,
    };
  };

  const folders = roots.map(buildFolder);
  const ungrouped =
    (options.includeUngrouped ?? false)
      ? sortAnnotations(ungroupedRecords).map((annotation, index) =>
          toExportAnnotation(annotation, index + 1, colorLabels),
        )
      : [];

  const totalCount =
    folders.reduce((sum, folder) => sum + folder.totalCount, 0) + ungrouped.length;

  return {
    title: options.title ?? "",
    folders,
    ungrouped,
    hasUngrouped: ungrouped.length > 0,
    totalCount,
  };
}
