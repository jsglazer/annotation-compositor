/**
 * The operation layer: every group-tag mutation in the plugin goes through
 * {@link GroupService.mutate}, which
 *   1. loads the item's annotations as plain records,
 *   2. asks a PURE core function for the tag diff,
 *   3. takes a pre-mutation snapshot, and
 *   4. hands the diff to the transactional tag writer.
 *
 * No caller writes tags itself, so the snapshot-before-write rule and the
 * single-transaction rule hold everywhere by construction.
 */
import { NotifierLoopGuard } from "../core/guard.js";
import { buildRecoveryPlan } from "../core/snapshot.js";
import type { Snapshot } from "../core/snapshot.js";
import { collectGroupTagsByItem, countMutations } from "../core/rewrite.js";
import type { RewriteResult } from "../core/rewrite.js";
import type { AnnotationRecord, TagDiffEntry, TagType } from "../core/types.js";
import { loadAnnotations } from "../adapters/annotations.js";
import type { AnnotationSet } from "../adapters/annotations.js";
import { applyTagDiff, rewriteTagTypes } from "../adapters/tagWriter.js";
import { SnapshotStore } from "./snapshotStore.js";
import { getTagPrefix, getTagType } from "./prefs.js";

export interface MutationOutcome {
  readonly ok: boolean;
  /** Populated when `ok` is false. */
  readonly error?: string;
  readonly changedCount: number;
  readonly mutationCount: number;
  readonly snapshotPath?: string;
}

export class GroupService {
  constructor(
    readonly guard: NotifierLoopGuard = new NotifierLoopGuard({ now: () => Date.now() }),
    private readonly snapshots: SnapshotStore = new SnapshotStore(),
  ) {}

  /** Load the annotations of an item as plain records plus their live items. */
  load(item: Zotero.Item): AnnotationSet {
    return loadAnnotations(item);
  }

  /**
   * Run one folder operation end to end. `compute` is a pure core function; it
   * never sees a Zotero object.
   */
  async mutate(
    item: Zotero.Item,
    reason: string,
    compute: (records: readonly AnnotationRecord[], prefix: string) => RewriteResult,
  ): Promise<MutationOutcome> {
    const prefix = getTagPrefix();
    const set = this.load(item);
    const result = compute(set.records, prefix);
    if (!result.ok) {
      return { ok: false, error: result.error, changedCount: 0, mutationCount: 0 };
    }
    if (result.diff.length === 0) {
      return { ok: true, changedCount: 0, mutationCount: 0 };
    }
    return this.write(item, set, result.diff, prefix, reason);
  }

  /** Snapshot, then write — the only path that reaches the tag writer. */
  async write(
    item: Zotero.Item,
    set: AnnotationSet,
    diff: readonly TagDiffEntry[],
    prefix: string,
    reason: string,
  ): Promise<MutationOutcome> {
    const tagType = getTagType();
    const stored = await this.snapshots.capture(
      item.key,
      set.records,
      prefix,
      tagType,
      reason,
    );
    const written = await applyTagDiff(diff, {
      itemsByKey: set.itemsByKey,
      tagType,
      guard: this.guard,
    });
    return {
      ok: true,
      changedCount: written.changedItemIds.length,
      mutationCount: countMutations(diff),
      snapshotPath: stored.path,
    };
  }

  /** Preview a snapshot restore without writing anything. */
  previewRestore(
    item: Zotero.Item,
    snapshot: Snapshot,
  ): ReturnType<typeof buildRecoveryPlan> {
    return buildRecoveryPlan(snapshot, this.load(item).records);
  }

  /** Apply a snapshot restore — itself snapshotted first, so it can be undone. */
  async restore(item: Zotero.Item, snapshot: Snapshot): Promise<MutationOutcome> {
    const set = this.load(item);
    const plan = buildRecoveryPlan(snapshot, set.records);
    if (plan.diff.length === 0) {
      return { ok: true, changedCount: 0, mutationCount: 0 };
    }
    return this.write(item, set, plan.diff, getTagPrefix(), "pre-restore");
  }

  /**
   * Switch every existing group tag on an item between manual and automatic.
   * Snapshot-backed, like every other write; the tag type is a parameter, never
   * hard-coded at the call site.
   */
  async rewriteTagType(item: Zotero.Item, tagType: TagType): Promise<MutationOutcome> {
    const prefix = getTagPrefix();
    const set = this.load(item);
    const tagsByItem = collectGroupTagsByItem(set.records, prefix);
    if (tagsByItem.length === 0) {
      return { ok: true, changedCount: 0, mutationCount: 0 };
    }
    const stored = await this.snapshots.capture(
      item.key,
      set.records,
      prefix,
      tagType,
      "pre-tag-type-switch",
    );
    const written = await rewriteTagTypes(tagsByItem, {
      itemsByKey: set.itemsByKey,
      tagType,
      guard: this.guard,
    });
    return {
      ok: true,
      changedCount: written.changedItemIds.length,
      mutationCount: written.addCount + written.removeCount,
      snapshotPath: stored.path,
    };
  }

  /** Snapshots on disk for an item, newest first. */
  listSnapshots(item: Zotero.Item): Promise<Awaited<ReturnType<SnapshotStore["list"]>>> {
    return this.snapshots.list(item.key);
  }

  /** Take a snapshot without mutating anything (manual backup command). */
  backup(item: Zotero.Item): Promise<Awaited<ReturnType<SnapshotStore["capture"]>>> {
    const set = this.load(item);
    return this.snapshots.capture(
      item.key,
      set.records,
      getTagPrefix(),
      getTagType(),
      "manual-backup",
    );
  }

  get store(): SnapshotStore {
    return this.snapshots;
  }
}
