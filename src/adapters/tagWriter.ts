/**
 * The single write path for group tags.
 *
 * Every multi-annotation mutation goes through {@link applyTagDiff}, which
 * wraps the whole batch in ONE `Zotero.DB.executeTransaction` — never a loop of
 * `item.saveTx()` calls — and registers the affected ids with the notifier loop
 * guard before the first save, so no self-triggered `modify` event can be
 * mistaken for a user edit. Notifier events raised inside the transaction are
 * queued by Zotero and delivered once, on commit.
 */
import type { NotifierLoopGuard } from "../core/guard.js";
import type { TagDiffEntry, TagType } from "../core/types.js";

/** Marker attached to every notifier event this plugin causes. */
export const NOTIFIER_MARKER = "annotationCompositor";

export interface TagWriteContext {
  /** Live annotation items, keyed as in the diff. */
  readonly itemsByKey: ReadonlyMap<string, Zotero.Item>;
  /** 0 = manual (default), 1 = automatic. Never hard-coded at call sites. */
  readonly tagType: TagType;
  /** Re-entrancy guard shared with the notifier listener. */
  readonly guard: NotifierLoopGuard;
}

export interface TagWriteResult {
  readonly changedItemIds: readonly string[];
  readonly addCount: number;
  readonly removeCount: number;
}

/**
 * Apply a tag diff atomically. Returns the ids actually written. Throws on a
 * database failure, having first released the guard entries so a rolled-back
 * write cannot deadlock the listener.
 */
export async function applyTagDiff(
  diff: readonly TagDiffEntry[],
  ctx: TagWriteContext,
): Promise<TagWriteResult> {
  const entries = diff.filter(
    (entry) =>
      ctx.itemsByKey.has(entry.itemId) &&
      (entry.add.length > 0 || entry.remove.length > 0),
  );
  if (entries.length === 0) {
    return { changedItemIds: [], addCount: 0, removeCount: 0 };
  }

  const ids = entries.map((entry) => entry.itemId);
  let addCount = 0;
  let removeCount = 0;

  // Register BEFORE the first save: the guard must already hold the ids when
  // Zotero delivers the queued `modify` events on commit.
  ctx.guard.beginWrite(ids);
  try {
    await Zotero.DB.executeTransaction(async () => {
      for (const entry of entries) {
        const item = ctx.itemsByKey.get(entry.itemId);
        if (item === undefined) {
          continue;
        }
        for (const tag of entry.remove) {
          item.removeTag(tag);
          removeCount += 1;
        }
        for (const tag of entry.add) {
          item.addTag(tag, ctx.tagType);
          addCount += 1;
        }
        await item.save({
          skipDateModifiedUpdate: true,
          skipSelect: true,
          notifierData: { [NOTIFIER_MARKER]: true },
        });
      }
    });
  } catch (error) {
    ctx.guard.cancelWrite(ids);
    throw error;
  }
  return { changedItemIds: ids, addCount, removeCount };
}

/**
 * Rewrite existing group tags with a different tag type (manual <-> automatic).
 * Zotero stores the type on the item-tag link, so the tag is removed and
 * re-added inside the same transaction; no path changes.
 */
export async function rewriteTagTypes(
  tagsByItem: readonly { readonly itemId: string; readonly tags: readonly string[] }[],
  ctx: TagWriteContext,
): Promise<TagWriteResult> {
  const diff: TagDiffEntry[] = tagsByItem
    .filter((entry) => entry.tags.length > 0)
    .map((entry) => ({
      itemId: entry.itemId,
      add: [...entry.tags],
      remove: [...entry.tags],
    }));
  return applyTagDiff(diff, ctx);
}
