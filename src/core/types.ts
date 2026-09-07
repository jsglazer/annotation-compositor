/**
 * Pure data contracts shared by every core module.
 *
 * PURITY CONTRACT (reviewer criterion #1): nothing under `src/core/` may import
 * or reference `Zotero`, `ZoteroPane`, `window`, `document`, `rootURI`, node
 * built-ins, or any other ambient global. Every value a core function needs is
 * passed in as a plain object, and every function returns plain data.
 */

/** A single annotation, flattened to plain data at the adapter boundary. */
export interface AnnotationRecord {
  /** Stable identifier (Zotero item key). Used verbatim in tag diffs. */
  readonly id: string;
  /** Annotation type: highlight | underline | note | image | ink | text. */
  readonly type: string;
  /** Colour as authored by Zotero, e.g. `#ffd400`. May be any case. */
  readonly color: string;
  /** Selected text (highlight/underline), empty otherwise. */
  readonly text: string;
  /** User comment, possibly empty. */
  readonly comment: string;
  /** Page label as shown in the reader, possibly empty. */
  readonly pageLabel: string;
  /** Zotero `annotationSortIndex` — the canonical document order key. */
  readonly sortIndex: string;
  /** Every tag currently on the annotation, group tags included. */
  readonly tags: readonly string[];
  /** ISO date string, used only for display/export. */
  readonly dateModified: string;
  /** Author display name, used only for display/export. */
  readonly authorName: string;
}

/** A folder path expressed as its segments below the tag prefix. */
export type FolderPath = readonly string[];

/**
 * A minimal, per-item tag mutation. `add` and `remove` are always disjoint,
 * deduplicated and sorted, so diffs compare equal regardless of how they were
 * derived. An entry is never emitted with both lists empty.
 */
export interface TagDiffEntry {
  readonly itemId: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/** Tag type as stored by Zotero: 0 = manual, 1 = automatic. */
export const TAG_TYPE_MANUAL = 0;
export const TAG_TYPE_AUTOMATIC = 1;
export type TagType = typeof TAG_TYPE_MANUAL | typeof TAG_TYPE_AUTOMATIC;

/** A colour → folder-paths mapping applied at annotation-creation time only. */
export interface ColorRule {
  /** Hex colour, matched case-insensitively. */
  readonly color: string;
  /** Target folder paths (segments below the prefix). */
  readonly paths: readonly FolderPath[];
}

/** View-model node for one folder in the rendered tree. */
export interface FolderNode {
  /** Leaf name of this folder. */
  readonly name: string;
  /** Full path segments below the prefix. */
  readonly path: FolderPath;
  /** Stable key — the path joined by the separator. */
  readonly key: string;
  /** Annotation ids tagged with exactly this path. */
  readonly annotationIds: readonly string[];
  /** Count of annotations at this node only. */
  readonly directCount: number;
  /** Count of distinct annotations at this node or any descendant. */
  readonly totalCount: number;
  /** True when the node has children, even if they are not rendered. */
  readonly hasChildren: boolean;
  /** True when the user collapsed this node; children are then omitted. */
  readonly collapsed: boolean;
  /** Distinct annotation colours in this subtree, sorted, for swatches. */
  readonly colors: readonly string[];
  /** Child folders. Empty when `collapsed` is true. */
  readonly children: readonly FolderNode[];
}

/** UI state fed into the render, kept outside the tree builder. */
export interface UiState {
  /** Folder keys the user collapsed. */
  readonly collapsedKeys?: readonly string[];
  /**
   * Folder keys the user created that hold no annotation yet. Empty folders
   * cannot exist as tags, so they live in UI state until first assignment.
   */
  readonly pendingFolderKeys?: readonly string[];
  /** Case-insensitive substring filter over annotation text/comment/folder. */
  readonly filter?: string;
}

/** The whole rendered panel, as plain objects. */
export interface PanelViewModel {
  readonly folders: readonly FolderNode[];
  /**
   * Annotations carrying no prefixed tag. Derived at render time; never
   * written to disk and never present in a tag diff.
   */
  readonly ungrouped: readonly AnnotationRecord[];
  /** Every annotation that survived the filter, by id. */
  readonly annotationsById: Readonly<Record<string, AnnotationRecord>>;
  /** Total annotations after filtering. */
  readonly totalCount: number;
}
