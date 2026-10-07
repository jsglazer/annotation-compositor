/**
 * Export view model: annotations + selected folders -> a plain template context.
 * Pure: no globals, no I/O.
 *
 * An annotation is rendered once per selected folder it belongs to; duplicates
 * across folders are intended output. Ordering inside every folder is by
 * `annotationSortIndex`.
 */
import { comparePaths, groupPaths, isBelow, pathKey } from "./path.js";
import {
  ANNOTATION_COLOR_NAMES,
  normalizeColorHex,
  resolveColorLabel,
} from "./colorNames.js";
import { formatEntry, formatShowsComment, passesLabelFilter } from "./entryFormat.js";
import type { EscapeKind, LabelFilter } from "./entryFormat.js";
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
  /** `hasComment`, unless the entry format already prints the comment itself. */
  readonly showComment: boolean;
  readonly tags: readonly string[];
  /** The annotation rendered through the user's entry format, escaped for the output. */
  readonly entry: string;
}

/** One colour label's annotations inside a folder, for the "Group > Label" presets. */
export interface ExportLabelGroup {
  readonly label: string;
  readonly color: string;
  readonly count: number;
  readonly isFirst: boolean;
  readonly annotations: readonly ExportAnnotation[];
}

export interface ExportFolder {
  readonly name: string;
  readonly path: string;
  readonly key: string;
  readonly depth: number;
  readonly count: number;
  readonly totalCount: number;
  readonly annotations: readonly ExportAnnotation[];
  /** This folder's own annotations split by colour label, in first-appearance order. */
  readonly labelGroups: readonly ExportLabelGroup[];
  readonly folders: readonly ExportFolder[];
  readonly hasAnnotations: boolean;
  readonly hasFolders: boolean;
  /** First among its siblings — lets a template put a separator between folders. */
  readonly isFirst: boolean;
}

export interface ExportContext extends Record<string, unknown> {
  readonly title: string;
  readonly folders: readonly ExportFolder[];
  readonly ungrouped: readonly ExportAnnotation[];
  readonly ungroupedLabelGroups: readonly ExportLabelGroup[];
  readonly hasUngrouped: boolean;
  readonly hasFolders: boolean;
  /** Templates that support it start every top-level group on a new page. */
  readonly pageBreak: boolean;
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
  /** One-line entry format (see `entryFormat.ts`); blank means the default. */
  readonly entryFormat?: string;
  /** How placeholder values in `entry` are escaped for the output format. */
  readonly entryEscape?: EscapeKind;
  /** Colour labels to keep or drop. */
  readonly labelFilter?: LabelFilter;
  /** Passed through to the template as `pageBreak`. */
  readonly pageBreak?: boolean;
}

interface EntrySettings {
  readonly colorLabels: Readonly<Record<string, string>>;
  readonly format: string;
  readonly escape: EscapeKind;
  readonly showsComment: boolean;
}

/** Every name an annotation's colour answers to: its display label and built-in name. */
function labelNames(
  color: string,
  colorLabels: Readonly<Record<string, string>>,
): string[] {
  const names = [resolveColorLabel(color, colorLabels)];
  const canonical = ANNOTATION_COLOR_NAMES[normalizeColorHex(color)];
  if (canonical !== undefined && !names.includes(canonical)) {
    names.push(canonical);
  }
  return names;
}

function toExportAnnotation(
  annotation: AnnotationRecord,
  index: number,
  settings: EntrySettings,
): ExportAnnotation {
  const colorLabel = resolveColorLabel(annotation.color, settings.colorLabels);
  const hasComment = annotation.comment.length > 0;
  const entry = formatEntry(
    settings.format,
    {
      text: annotation.text.length > 0 ? annotation.text : `(${annotation.type})`,
      page: annotation.pageLabel,
      label: colorLabel,
      comment: annotation.comment,
      type: annotation.type,
      color: annotation.color,
      author: annotation.authorName,
      date: annotation.dateModified,
      tags: annotation.tags.join(", "),
      index: String(index),
    },
    settings.escape,
  );
  return {
    id: annotation.id,
    index,
    type: annotation.type,
    color: annotation.color,
    colorLabel,
    text: annotation.text,
    comment: annotation.comment,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    dateModified: annotation.dateModified,
    authorName: annotation.authorName,
    hasText: annotation.text.length > 0,
    hasComment,
    showComment: hasComment && !settings.showsComment,
    tags: [...annotation.tags],
    entry,
  };
}

/** Split already-numbered annotations by colour label, keeping their order. */
function byLabel(annotations: readonly ExportAnnotation[]): ExportLabelGroup[] {
  const groups = new Map<string, ExportAnnotation[]>();
  for (const annotation of annotations) {
    const bucket = groups.get(annotation.colorLabel);
    if (bucket === undefined) {
      groups.set(annotation.colorLabel, [annotation]);
    } else {
      bucket.push(annotation);
    }
  }
  return [...groups.entries()].map(([label, members], position) => ({
    label,
    color: members[0].color,
    count: members.length,
    isFirst: position === 0,
    annotations: members,
  }));
}

/** Build the template context. Input arrays are never mutated. */
export function buildExportContext(
  annotations: readonly AnnotationRecord[],
  tagPrefix: string,
  options: ExportOptions,
): ExportContext {
  const colorLabels = options.colorLabels ?? {};
  const format = options.entryFormat ?? "";
  const settings: EntrySettings = {
    colorLabels,
    format,
    escape: options.entryEscape ?? "none",
    showsComment: formatShowsComment(format),
  };
  const membership = new Map<string, AnnotationRecord[]>();
  const ungroupedRecords: AnnotationRecord[] = [];
  for (const annotation of annotations) {
    if (
      !passesLabelFilter(options.labelFilter, labelNames(annotation.color, colorLabels))
    ) {
      continue;
    }
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

  const buildFolder = (path: FolderPath, position: number): ExportFolder => {
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
    const exported = own.map((annotation, index) =>
      toExportAnnotation(annotation, index + 1, settings),
    );
    return {
      name: path.length === 0 ? "" : path[path.length - 1],
      path: key,
      key,
      depth: path.length,
      count: own.length,
      totalCount,
      annotations: exported,
      labelGroups: byLabel(exported),
      folders: children,
      hasAnnotations: own.length > 0,
      hasFolders: children.length > 0,
      isFirst: position === 0,
    };
  };

  const folders = roots.map(buildFolder);
  const ungrouped =
    (options.includeUngrouped ?? false)
      ? sortAnnotations(ungroupedRecords).map((annotation, index) =>
          toExportAnnotation(annotation, index + 1, settings),
        )
      : [];

  const totalCount =
    folders.reduce((sum, folder) => sum + folder.totalCount, 0) + ungrouped.length;

  return {
    title: options.title ?? "",
    folders,
    ungrouped,
    ungroupedLabelGroups: byLabel(ungrouped),
    hasUngrouped: ungrouped.length > 0,
    hasFolders: folders.length > 0,
    pageBreak: options.pageBreak ?? false,
    totalCount,
  };
}
