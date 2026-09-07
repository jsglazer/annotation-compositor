/**
 * Snapshot serialisation and recovery planning.
 * Pure: no globals, no I/O — the caller supplies the clock and does the writing.
 *
 * Snapshots are the sole safety net against Zotero's library-wide
 * "Delete Automatic Tags in This Library" action and the only undo affordance
 * in v1, so parsing is strict and recovery is expressed as an ordinary tag diff.
 */
import { formatTag, parseTag } from "./path.js";
import type { AnnotationRecord, TagDiffEntry, TagType } from "./types.js";
import { TAG_TYPE_MANUAL } from "./types.js";

export const SNAPSHOT_VERSION = 1;

/** Rolling snapshots kept per item, plus the pre-mutation snapshot. */
export const SNAPSHOT_RETENTION = 20;

export interface SnapshotEntry {
  readonly id: string;
  /** Group tags only — foreign tags are never captured or restored. */
  readonly tags: readonly string[];
}

export interface Snapshot {
  readonly version: number;
  readonly itemKey: string;
  readonly prefix: string;
  readonly tagType: TagType;
  /** ISO timestamp supplied by the caller; the core never reads a clock. */
  readonly createdAt: string;
  /** What the snapshot was taken for, e.g. `pre-rename`. */
  readonly reason: string;
  readonly entries: readonly SnapshotEntry[];
}

export class SnapshotError extends Error {}

export interface SnapshotMeta {
  readonly itemKey: string;
  readonly createdAt: string;
  readonly reason: string;
  readonly tagType?: TagType;
}

/** Capture the group-tag state of every annotation on one item. */
export function createSnapshot(
  annotations: readonly AnnotationRecord[],
  prefix: string,
  meta: SnapshotMeta,
): Snapshot {
  const entries: SnapshotEntry[] = annotations
    .map((annotation) => ({
      id: annotation.id,
      tags: [
        ...new Set(annotation.tags.filter((tag) => parseTag(tag, prefix) !== null)),
      ].sort(),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    version: SNAPSHOT_VERSION,
    itemKey: meta.itemKey,
    prefix,
    tagType: meta.tagType ?? TAG_TYPE_MANUAL,
    createdAt: meta.createdAt,
    reason: meta.reason,
    entries,
  };
}

/** Stable JSON: fixed key order and sorted entries, so round-trips are exact. */
export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(
    {
      version: snapshot.version,
      itemKey: snapshot.itemKey,
      prefix: snapshot.prefix,
      tagType: snapshot.tagType,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      entries: snapshot.entries.map((entry) => ({ id: entry.id, tags: [...entry.tags] })),
    },
    null,
    2,
  );
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    return raise(`Snapshot field "${field}" must be a string.`);
  }
  return value;
}

function raise(message: string): never {
  throw new SnapshotError(message);
}

/** Parse and validate snapshot JSON. Throws {@link SnapshotError} when corrupt. */
export function parseSnapshot(json: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raise("Snapshot is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raise("Snapshot must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== SNAPSHOT_VERSION) {
    raise(`Unsupported snapshot version: ${String(record.version)}.`);
  }
  if (!Array.isArray(record.entries)) {
    raise('Snapshot field "entries" must be an array.');
  }
  const entries: SnapshotEntry[] = record.entries.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      raise(`Snapshot entry ${index} must be an object.`);
    }
    const entry = value as Record<string, unknown>;
    const id = requireString(entry.id, `entries[${index}].id`);
    if (!Array.isArray(entry.tags)) {
      raise(`Snapshot entry ${index} has no tag list.`);
    }
    const tags = entry.tags.map((tag, tagIndex) =>
      requireString(tag, `entries[${index}].tags[${tagIndex}]`),
    );
    return { id, tags: [...new Set(tags)].sort() };
  });
  const tagType = record.tagType === 1 ? 1 : 0;
  return {
    version: SNAPSHOT_VERSION,
    itemKey: requireString(record.itemKey, "itemKey"),
    prefix: requireString(record.prefix, "prefix"),
    tagType,
    createdAt: requireString(record.createdAt, "createdAt"),
    reason: typeof record.reason === "string" ? record.reason : "",
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export interface RecoveryPlan {
  /** Tag mutations that restore the snapshot state. */
  readonly diff: readonly TagDiffEntry[];
  /** Snapshot ids with no matching annotation on the item any more. */
  readonly missingIds: readonly string[];
  /** Annotations created since the snapshot; left untouched. */
  readonly unknownIds: readonly string[];
  /** Total tag additions the plan performs. */
  readonly addCount: number;
  /** Total tag removals the plan performs. */
  readonly removeCount: number;
}

/**
 * Compute the diff that restores `snapshot` over the current state — including
 * the total-loss case, where every group tag was wiped and the plan is pure
 * additions. Annotations created after the snapshot are reported, not modified.
 */
export function buildRecoveryPlan(
  snapshot: Snapshot,
  annotations: readonly AnnotationRecord[],
): RecoveryPlan {
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const diff: TagDiffEntry[] = [];
  const missingIds: string[] = [];
  let addCount = 0;
  let removeCount = 0;

  for (const entry of snapshot.entries) {
    const annotation = byId.get(entry.id);
    if (annotation === undefined) {
      missingIds.push(entry.id);
      continue;
    }
    const current = new Set(
      annotation.tags.filter((tag) => parseTag(tag, snapshot.prefix) !== null),
    );
    // Re-format through the path grammar so a snapshot written under a
    // different (migrated) prefix still restores under the current one.
    const desired = new Set(
      entry.tags.map((tag) => {
        const parsed = parseTag(tag, snapshot.prefix);
        return parsed === null ? tag : formatTag(snapshot.prefix, parsed);
      }),
    );
    const add = [...desired].filter((tag) => !current.has(tag)).sort();
    const remove = [...current].filter((tag) => !desired.has(tag)).sort();
    if (add.length === 0 && remove.length === 0) {
      continue;
    }
    addCount += add.length;
    removeCount += remove.length;
    diff.push({ itemId: entry.id, add, remove });
  }

  const known = new Set(snapshot.entries.map((entry) => entry.id));
  const unknownIds = annotations
    .filter((annotation) => !known.has(annotation.id))
    .map((annotation) => annotation.id)
    .sort();

  return {
    diff: diff.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
    missingIds: missingIds.sort(),
    unknownIds,
    addCount,
    removeCount,
  };
}

/**
 * Which snapshot filenames to delete so at most `limit` remain. Names are
 * sorted lexicographically, which is chronological because the file name
 * starts with a zero-padded ISO timestamp.
 */
export function retentionDeletions(
  fileNames: readonly string[],
  limit: number = SNAPSHOT_RETENTION,
): string[] {
  const sorted = [...fileNames].sort();
  const excess = sorted.length - Math.max(0, limit);
  return excess <= 0 ? [] : sorted.slice(0, excess);
}
