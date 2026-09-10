/**
 * Reader navigation adapter.
 *
 * Every `Zotero.Reader` call goes through here, and every one of them first
 * checks that the tab and reader are still alive — a reader can be closed
 * between the click and the navigation.
 */
import type { FolderPath } from "../core/types.js";

/** A reader instance we have validated far enough to use. */
type ValidatedReader = _ZoteroTypes.ReaderInstance & { itemID: number };

export function readers(): ValidatedReader[] {
  const list = (Zotero.Reader?._readers ?? []) as unknown[];
  return list.filter(
    (candidate): candidate is ValidatedReader =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as ValidatedReader).navigate === "function" &&
      typeof (candidate as ValidatedReader).itemID === "number",
  );
}

/** The open reader for an attachment, or `null` when it is not open. */
export function findReader(attachmentID: number): ValidatedReader | null {
  return readers().find((reader) => reader.itemID === attachmentID) ?? null;
}

/** The attachment id of the reader in the foreground tab, or `null`. */
export function activeReaderAttachmentID(): number | null {
  const tab = Zotero.getMainWindow()?.Zotero_Tabs;
  if (tab === undefined || typeof tab.selectedID !== "string") {
    return null;
  }
  const reader = Zotero.Reader?.getByTabID?.(tab.selectedID) as
    { itemID?: number } | undefined | null;
  return typeof reader?.itemID === "number" ? reader.itemID : null;
}

/**
 * The location descriptor the reader understands for "scroll to this annotation".
 *
 * The reader keys annotations by `annotationID`, and the value it stores there
 * IS the Zotero item key — which is why `selectedAnnotationIDs` below yields
 * item keys. Passing `annotationKey` instead (what an earlier version did) is
 * silently ignored by the reader, so nothing ever scrolled. `annotationKey` is
 * still sent alongside: unknown keys are harmless, and it keeps the call
 * working if a future reader renames the field back.
 */
function annotationLocation(annotation: Zotero.Item): Record<string, string> {
  return { annotationID: annotation.key, annotationKey: annotation.key };
}

/**
 * Scroll the reader to an annotation. Returns false — never throws — when the
 * reader or its tab has gone away, or when the annotation has no parent.
 */
export function navigateToAnnotation(annotation: Zotero.Item): boolean {
  const attachmentID = annotation.parentID;
  if (typeof attachmentID !== "number") {
    return false;
  }
  const reader = findReader(attachmentID);
  if (reader === null) {
    return false;
  }
  // navigate() only scrolls within the reader itself — it never brings a
  // background reader tab to the foreground, which made clicks silently
  // no-op whenever the annotation's reader tab wasn't already selected.
  // Its own try/catch: a tab-select failure must not skip the navigate below,
  // which is what made the whole click a no-op.
  try {
    const tabID = (reader as unknown as { tabID?: string }).tabID;
    if (typeof tabID === "string") {
      Zotero.getMainWindow()?.Zotero_Tabs.select(tabID);
    }
  } catch {
    // Tab gone or not selectable — still worth trying to scroll the reader.
  }
  try {
    reader.navigate(annotationLocation(annotation) as never);
    return true;
  } catch {
    return false;
  }
}

/** Open the attachment in a reader tab, then scroll to the annotation. */
export async function openAndNavigate(annotation: Zotero.Item): Promise<boolean> {
  const attachmentID = annotation.parentID;
  if (typeof attachmentID !== "number") {
    return false;
  }
  if (findReader(attachmentID) === null) {
    await Zotero.Reader.open(attachmentID, annotationLocation(annotation) as never);
    // Opening positions the reader itself, but a freshly-opened reader can
    // finish loading after open() resolves; navigate again once it exists.
    return navigateToAnnotation(annotation) || findReader(attachmentID) !== null;
  }
  return navigateToAnnotation(annotation);
}

/**
 * Reads a reader's currently-selected annotation id, straight out of its
 * internal React state. There is no public "selection changed" event for the
 * reader (text clicks and the native sidebar both land here, but neither is
 * observable from outside), so `ReaderSelectionWatcher` below polls this.
 * Any unrecognised shape is treated as "no selection" rather than thrown.
 */
function selectedAnnotationKey(reader: ValidatedReader): string | null {
  const state = (
    reader as unknown as {
      _internalReader?: { _state?: { selectedAnnotationIDs?: unknown } };
    }
  )._internalReader?._state;
  const ids = state?.selectedAnnotationIDs;
  return Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "string"
    ? ids[0]
    : null;
}

/** Reports the moment a reader's single-annotation selection changes. */
export class ReaderSelectionWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastByAttachment = new Map<number, string | null>();

  constructor(
    private readonly onSelect: (attachmentID: number, annotationKey: string) => void,
    private readonly intervalMs: number = 400,
  ) {}

  register(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  unregister(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastByAttachment.clear();
  }

  private poll(): void {
    const seen = new Set<number>();
    for (const reader of readers()) {
      seen.add(reader.itemID);
      const key = selectedAnnotationKey(reader);
      if (key !== null && key !== this.lastByAttachment.get(reader.itemID)) {
        this.onSelect(reader.itemID, key);
      }
      this.lastByAttachment.set(reader.itemID, key);
    }
    for (const attachmentID of [...this.lastByAttachment.keys()]) {
      if (!seen.has(attachmentID)) {
        this.lastByAttachment.delete(attachmentID);
      }
    }
  }
}

/**
 * Sticky-group state, keyed by the key of the top-level item that owns the
 * folder.
 *
 * Keyed by ITEM rather than by reader tab id, because a folder path only means
 * anything inside the item whose annotation tags define it. Zotero hands out
 * tab ids per session and recycles them, so a tab-keyed pin did two wrong
 * things at once: it was lost the moment the item was closed and reopened (or
 * Zotero restarted), and it re-attached itself to whatever unrelated item
 * happened to inherit the id — which is how one item's folder ended up
 * auto-filing another item's new annotations.
 *
 * `onChange` is called after every mutation so the caller can persist the map
 * immediately; waiting for shutdown loses the pin whenever Zotero does not exit
 * cleanly.
 */
export class StickyGroupRegistry {
  private readonly byItem = new Map<string, FolderPath>();

  constructor(
    persisted: Readonly<Record<string, FolderPath>> = {},
    private readonly onChange: (groups: Record<string, FolderPath>) => void = () => {},
  ) {
    this.adopt(persisted);
  }

  /** Load a persisted map, ignoring anything that is not a real folder path. */
  adopt(persisted: Readonly<Record<string, FolderPath>>): void {
    for (const [itemKey, path] of Object.entries(persisted)) {
      if (
        typeof itemKey === "string" &&
        itemKey.length > 0 &&
        Array.isArray(path) &&
        path.length > 0 &&
        path.every((segment) => typeof segment === "string")
      ) {
        this.byItem.set(itemKey, [...path]);
      }
    }
  }

  get(itemKey: string): FolderPath | null {
    return this.byItem.get(itemKey) ?? null;
  }

  set(itemKey: string, path: FolderPath | null): void {
    if (path === null || path.length === 0) {
      this.byItem.delete(itemKey);
    } else {
      this.byItem.set(itemKey, [...path]);
    }
    this.onChange(this.toJSON());
  }

  /**
   * Move a pin that names `source` (or something below it) onto `target`, so a
   * renamed or reparented folder keeps its pin instead of silently losing it.
   */
  remap(itemKey: string, source: FolderPath, target: FolderPath): void {
    const current = this.byItem.get(itemKey);
    if (current === undefined || current.length < source.length) {
      return;
    }
    if (!source.every((segment, index) => current[index] === segment)) {
      return;
    }
    this.set(itemKey, [...target, ...current.slice(source.length)]);
  }

  toJSON(): Record<string, FolderPath> {
    return Object.fromEntries(this.byItem);
  }

  clear(): void {
    this.byItem.clear();
  }
}
