/**
 * Zotero item <-> `AnnotationRecord` boundary.
 *
 * This is the only place annotation items are read. Everything downstream works
 * on plain records, so the pure core never sees a Zotero object.
 */
import type { AnnotationRecord } from "../core/types.js";

/** Attachment types that can carry annotations. */
const ANNOTATABLE_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/epub+zip",
  "text/html",
]);

/** Flatten one Zotero annotation item into a plain record. */
export function toRecord(item: Zotero.Item): AnnotationRecord {
  return {
    id: item.key,
    type: String(item.annotationType ?? ""),
    color: String(item.annotationColor ?? ""),
    text: String(item.annotationText ?? ""),
    comment: String(item.annotationComment ?? ""),
    pageLabel: String(item.annotationPageLabel ?? ""),
    sortIndex: String(item.annotationSortIndex ?? ""),
    tags: item.getTags().map((tag) => tag.tag),
    dateModified: String(item.dateModified ?? ""),
    authorName: String(item.annotationAuthorName ?? ""),
  };
}

/** The attachments of `item` that can hold annotations (or `item` itself). */
export function annotatableAttachments(item: Zotero.Item): Zotero.Item[] {
  if (item.isAttachment()) {
    return ANNOTATABLE_CONTENT_TYPES.has(item.attachmentContentType ?? "") ? [item] : [];
  }
  if (!item.isRegularItem()) {
    return [];
  }
  return Zotero.Items.get(item.getAttachments())
    .filter((attachment) => attachment.isAttachment())
    .filter((attachment) =>
      ANNOTATABLE_CONTENT_TYPES.has(attachment.attachmentContentType ?? ""),
    );
}

export interface AnnotationSet {
  /** Plain records for the pure core. */
  readonly records: AnnotationRecord[];
  /** Key -> live Zotero item, for the tag writer only. */
  readonly itemsByKey: Map<string, Zotero.Item>;
  /** The attachments the annotations came from. */
  readonly attachments: Zotero.Item[];
}

/** Load every annotation belonging to `item` (or to its attachments). */
export function loadAnnotations(item: Zotero.Item): AnnotationSet {
  const attachments = annotatableAttachments(item);
  const records: AnnotationRecord[] = [];
  const itemsByKey = new Map<string, Zotero.Item>();
  for (const attachment of attachments) {
    for (const annotation of attachment.getAnnotations()) {
      records.push(toRecord(annotation));
      itemsByKey.set(annotation.key, annotation);
    }
  }
  return { records, itemsByKey, attachments };
}

/** Look up annotation items by key inside one library. */
export function getAnnotationItems(
  libraryID: number,
  keys: readonly string[],
): Map<string, Zotero.Item> {
  const found = new Map<string, Zotero.Item>();
  for (const key of keys) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (item !== false && typeof item !== "boolean") {
      found.set(key, item as Zotero.Item);
    }
  }
  return found;
}
