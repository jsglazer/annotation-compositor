/**
 * Colour rules and sticky group, applied at annotation-creation time only.
 *
 * The decision of WHICH groups a new annotation joins is pure
 * (`core/rules.ts`); this module only gathers the inputs and hands the
 * resulting add-only diff to the snapshot-backed writer, one transaction per
 * parent item — which is also what keeps rapid highlighting from turning into a
 * storm of competing SQLite writes.
 */
import { groupPaths } from "../core/path.js";
import { newAnnotationDiff } from "../core/rules.js";
import type { TagDiffEntry } from "../core/types.js";
import { toRecord } from "../adapters/annotations.js";
import type { StickyGroupRegistry } from "../adapters/reader.js";
import type { GroupService } from "./groupService.js";
import { getItemColorRules, getLibraryColorRules, getTagPrefix } from "./prefs.js";

/** The top-level item an annotation belongs to, or `null`. */
function topLevelItem(annotation: Zotero.Item): Zotero.Item | null {
  const attachment = annotation.parentItem;
  if (attachment === undefined) {
    return null;
  }
  return attachment.parentItem ?? attachment;
}

/**
 * Apply colour rules and the sticky group to newly created annotations.
 * Additive only: no existing membership is ever removed.
 */
export async function assignNewAnnotations(
  service: GroupService,
  sticky: StickyGroupRegistry,
  annotations: readonly Zotero.Item[],
): Promise<void> {
  if (annotations.length === 0) {
    return;
  }
  const prefix = getTagPrefix();
  const libraryRules = getLibraryColorRules();

  // Group by parent item so each item gets exactly one transaction.
  const byParent = new Map<string, { item: Zotero.Item; annotations: Zotero.Item[] }>();
  for (const annotation of annotations) {
    const parent = topLevelItem(annotation);
    if (parent === null) {
      continue;
    }
    const bucket = byParent.get(parent.key);
    if (bucket === undefined) {
      byParent.set(parent.key, { item: parent, annotations: [annotation] });
    } else {
      bucket.annotations.push(annotation);
    }
  }

  for (const { item, annotations: created } of byParent.values()) {
    const itemRules = getItemColorRules(item.key);
    // The pin belongs to this item, so it can only ever file this item's own
    // new annotations — never annotations that happen to be created while some
    // other pinned item is on screen.
    const stickyPath = sticky.get(item.key);
    const diff: TagDiffEntry[] = [];
    for (const annotation of created) {
      const record = toRecord(annotation);
      const entry = newAnnotationDiff(record.id, prefix, {
        color: record.color,
        existingPaths: groupPaths(record.tags, prefix),
        libraryRules,
        itemRules,
        stickyPath,
      });
      if (entry !== null) {
        diff.push(entry);
      }
    }
    if (diff.length === 0) {
      continue;
    }
    const set = service.load(item);
    await service.write(item, set, diff, prefix, "pre-auto-assign");
  }
}
