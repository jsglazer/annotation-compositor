/**
 * The single path provider for everything this plugin writes.
 *
 * Reviewer criterion #5 is satisfied by reading this one module: every snapshot
 * path is `<Zotero data directory>/annotation-compositor/snapshots/...`, built
 * here and nowhere else. Nothing is written to the extension directory, which
 * Zotero replaces on plugin update. The only other file writes in the codebase
 * are exports to a path the user chose in the file picker.
 */

export const PLUGIN_DIR_NAME = "annotation-compositor";
export const SNAPSHOT_DIR_NAME = "snapshots";

export interface PathProvider {
  /** Root of everything the plugin owns on disk. */
  pluginDir(): string;
  /** Directory holding snapshots for one item. */
  snapshotDir(itemKey: string): string;
  /** Absolute path of one snapshot file. */
  snapshotFile(itemKey: string, stamp: string): string;
}

/** Keep a key safe to use as a directory name (Zotero keys are already [A-Z0-9]). */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}

/** Timestamp component of a snapshot file name; sorts chronologically. */
export function snapshotStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Production provider, rooted at the live Zotero data directory. */
export const dataDirectoryPathProvider: PathProvider = {
  pluginDir(): string {
    return PathUtils.join(Zotero.DataDirectory.dir, PLUGIN_DIR_NAME);
  },
  snapshotDir(itemKey: string): string {
    return PathUtils.join(
      Zotero.DataDirectory.dir,
      PLUGIN_DIR_NAME,
      SNAPSHOT_DIR_NAME,
      safeSegment(itemKey),
    );
  },
  snapshotFile(itemKey: string, stamp: string): string {
    return PathUtils.join(this.snapshotDir(itemKey), `${safeSegment(stamp)}.json`);
  },
};
