/**
 * Snapshot persistence: the only file I/O in the plugin besides user-chosen
 * export targets. Every path comes from the injected {@link PathProvider}, so
 * writes are confined to `<Zotero data dir>/annotation-compositor/snapshots/`.
 */
import {
  createSnapshot,
  parseSnapshot,
  retentionDeletions,
  serializeSnapshot,
  SNAPSHOT_RETENTION,
} from "../core/snapshot.js";
import type { Snapshot } from "../core/snapshot.js";
import type { AnnotationRecord, TagType } from "../core/types.js";
import { dataDirectoryPathProvider, snapshotStamp } from "../adapters/paths.js";
import type { PathProvider } from "../adapters/paths.js";

export interface StoredSnapshot {
  readonly fileName: string;
  readonly path: string;
  readonly snapshot: Snapshot;
}

export class SnapshotStore {
  constructor(
    private readonly paths: PathProvider = dataDirectoryPathProvider,
    private readonly clock: () => Date = () => new Date(),
    private readonly retention: number = SNAPSHOT_RETENTION,
  ) {}

  /**
   * Capture the current group-tag state of an item. Called immediately before
   * every group-tag write, and by the manual backup command.
   */
  async capture(
    itemKey: string,
    annotations: readonly AnnotationRecord[],
    prefix: string,
    tagType: TagType,
    reason: string,
  ): Promise<StoredSnapshot> {
    const now = this.clock();
    const snapshot = createSnapshot(annotations, prefix, {
      itemKey,
      createdAt: now.toISOString(),
      reason,
      tagType,
    });
    const dir = this.paths.snapshotDir(itemKey);
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    const path = this.paths.snapshotFile(itemKey, snapshotStamp(now));
    await IOUtils.writeUTF8(path, serializeSnapshot(snapshot));
    await this.prune(itemKey);
    return { fileName: PathUtils.filename(path), path, snapshot };
  }

  /** Snapshots for one item, newest first. Unreadable files are skipped. */
  async list(itemKey: string): Promise<StoredSnapshot[]> {
    const dir = this.paths.snapshotDir(itemKey);
    const children = await IOUtils.getChildren(dir, { ignoreAbsent: true });
    const stored: StoredSnapshot[] = [];
    for (const path of children
      .filter((child) => child.endsWith(".json"))
      .sort()
      .reverse()) {
      try {
        stored.push({
          fileName: PathUtils.filename(path),
          path,
          snapshot: parseSnapshot(await IOUtils.readUTF8(path)),
        });
      } catch {
        // A corrupt or partially written snapshot is skipped, never thrown:
        // the restore list must stay usable when one file is damaged.
      }
    }
    return stored;
  }

  /** Read one snapshot from an arbitrary user-chosen file (manual import). */
  async readFile(path: string): Promise<Snapshot> {
    return parseSnapshot(await IOUtils.readUTF8(path));
  }

  /** Write one snapshot to a user-chosen file (manual export). */
  async writeFile(path: string, snapshot: Snapshot): Promise<void> {
    await IOUtils.writeUTF8(path, serializeSnapshot(snapshot));
  }

  /** Enforce the rolling retention limit for one item. */
  async prune(itemKey: string): Promise<string[]> {
    const dir = this.paths.snapshotDir(itemKey);
    const children = await IOUtils.getChildren(dir, { ignoreAbsent: true });
    const names = children
      .filter((child) => child.endsWith(".json"))
      .map((child) => PathUtils.filename(child));
    const doomed = retentionDeletions(names, this.retention);
    for (const name of doomed) {
      await IOUtils.remove(
        this.paths.snapshotFile(itemKey, name.replace(/\.json$/, "")),
        {
          ignoreAbsent: true,
        },
      );
    }
    return doomed;
  }
}
