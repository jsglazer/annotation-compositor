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
  try {
    // navigate() only scrolls within the reader itself — it never brings a
    // background reader tab to the foreground, which made clicks silently
    // no-op whenever the annotation's reader tab wasn't already selected.
    Zotero.getMainWindow()?.Zotero_Tabs.select(reader.tabID);
    reader.navigate({ annotationKey: annotation.key });
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
    await Zotero.Reader.open(attachmentID, { annotationKey: annotation.key });
    return findReader(attachmentID) !== null;
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

/** Sticky-group state, keyed by reader tab id. */
export class StickyGroupRegistry {
  private readonly byTab = new Map<string, FolderPath>();

  constructor(persisted: Readonly<Record<string, FolderPath>> = {}) {
    for (const [tabID, path] of Object.entries(persisted)) {
      this.byTab.set(tabID, path);
    }
  }

  get(tabID: string): FolderPath | null {
    return this.byTab.get(tabID) ?? null;
  }

  set(tabID: string, path: FolderPath | null): void {
    if (path === null) {
      this.byTab.delete(tabID);
    } else {
      this.byTab.set(tabID, [...path]);
    }
  }

  /** Sticky group of the foreground tab, or `null`. */
  active(): FolderPath | null {
    const tabs = Zotero.getMainWindow()?.Zotero_Tabs;
    const tabID = typeof tabs?.selectedID === "string" ? tabs.selectedID : null;
    return tabID === null ? null : this.get(tabID);
  }

  toJSON(): Record<string, FolderPath> {
    return Object.fromEntries(this.byTab);
  }

  clear(): void {
    this.byTab.clear();
  }
}
