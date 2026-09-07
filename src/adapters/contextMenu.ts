/**
 * Reader annotation context menu ("Add to group ▸").
 *
 * Menu SHAPE is decided by `core/menuModel.ts` (pure, unit-tested); this
 * adapter only appends it. The nested-submenu capability is probed once per
 * session and cached: the first nested append is attempted inside a try/catch,
 * and if the reader's `append` implementation rejects a submenu descriptor we
 * fall back to flat `A > B > C` labels for the rest of the session.
 */
import { buildMenuModel, flattenEntries, FLAT_SEPARATOR } from "../core/menuModel.js";
import type { MenuEntry } from "../core/menuModel.js";
import type { FolderPath } from "../core/types.js";
import { promptText, select } from "./dialogs.js";

type AppendMenu = _ZoteroTypes.Reader.ReaderAppendType["appendMenu"];

/** A submenu descriptor. Not part of the typed API — hence the capability probe. */
interface NestedMenuItem {
  label: string;
  disabled?: boolean;
  onCommand?: () => void;
  menu?: NestedMenuItem[];
}

export interface ReaderMenuHost {
  /** Folder paths that currently exist for the annotations being assigned. */
  pathsFor(annotationKeys: readonly string[]): FolderPath[];
  /** Recently used folder keys, most recent first. */
  recentsFor(annotationKeys: readonly string[]): string[];
  /** Assign the annotations to a folder path. */
  assign(annotationKeys: readonly string[], path: FolderPath): Promise<void>;
}

export class ReaderMenuAdapter {
  /** Session cache for the capability probe: null = not probed yet. */
  private nestedSupported: boolean | null = null;
  private handler: _ZoteroTypes.Reader.EventHandler<"createAnnotationContextMenu"> | null =
    null;

  constructor(private readonly host: ReaderMenuHost) {}

  register(): void {
    if (this.handler !== null) {
      return;
    }
    this.handler = (event) => {
      const ids = event.params.ids;
      if (ids.length === 0) {
        return;
      }
      this.appendMenu(event.append, ids);
    };
    Zotero.Reader.registerEventListener(
      "createAnnotationContextMenu",
      this.handler,
      "annotation-compositor@jsglazer.com",
    );
  }

  unregister(): void {
    if (this.handler !== null) {
      Zotero.Reader.unregisterEventListener("createAnnotationContextMenu", this.handler);
      this.handler = null;
    }
  }

  /** Reset the cached probe result (used on shutdown). */
  resetProbe(): void {
    this.nestedSupported = null;
  }

  private appendMenu(append: AppendMenu, ids: readonly string[]): void {
    const model = buildMenuModel(this.host.pathsFor(ids), {
      nestedSupported: this.nestedSupported !== false,
      recentKeys: this.host.recentsFor(ids),
      labels: { more: "More…", newFolder: "New folder…", thisFolder: "This folder" },
    });

    if (model.shape !== "flat" && this.nestedSupported !== false) {
      try {
        this.appendNested(append, ids, model.entries);
        this.nestedSupported = true;
        return;
      } catch {
        // The reader rejected the submenu descriptor: remember that for the
        // session and fall through to the flat representation.
        this.nestedSupported = false;
      }
    }
    this.appendFlat(append, ids, flattenEntries(model.entries));
  }

  private appendNested(
    append: AppendMenu,
    ids: readonly string[],
    entries: readonly MenuEntry[],
  ): void {
    const nested = append as unknown as (item: NestedMenuItem) => void;
    nested({
      label: "Add to group",
      menu: entries.map((entry) => this.toNested(ids, entry)),
    });
  }

  private toNested(ids: readonly string[], entry: MenuEntry): NestedMenuItem {
    switch (entry.kind) {
      case "folder":
        return {
          label: entry.label,
          onCommand: () => void this.host.assign(ids, entry.path),
        };
      case "submenu":
        return {
          label: entry.label,
          menu: [
            this.toNested(ids, entry.selfEntry),
            ...entry.children.map((child) => this.toNested(ids, child)),
          ],
        };
      case "more":
        return { label: entry.label, onCommand: () => this.openPicker(ids) };
      default:
        return { label: entry.label, onCommand: () => this.createAndAssign(ids) };
    }
  }

  private appendFlat(
    append: AppendMenu,
    ids: readonly string[],
    entries: readonly MenuEntry[],
  ): void {
    for (const entry of entries) {
      if (entry.kind === "folder") {
        append({
          label: `Add to group: ${entry.label}`,
          onCommand: () => void this.host.assign(ids, entry.path),
        });
      } else if (entry.kind === "more") {
        append({ label: "Add to group: More…", onCommand: () => this.openPicker(ids) });
      } else if (entry.kind === "new") {
        append({
          label: "Add to group: New folder…",
          onCommand: () => this.createAndAssign(ids),
        });
      }
    }
  }

  /** Modal folder picker, used above the folder threshold and by the fallback. */
  private openPicker(ids: readonly string[]): void {
    const paths = this.host.pathsFor(ids);
    const labels = paths.map((path) => path.join(FLAT_SEPARATOR));
    const index = select("Add to group", "Choose a folder:", labels);
    if (index !== null && paths[index] !== undefined) {
      void this.host.assign(ids, paths[index]);
    }
  }

  private createAndAssign(ids: readonly string[]): void {
    const name = promptText("New folder", "Folder name:", "");
    if (name === null || name.trim().length === 0) {
      return;
    }
    void this.host.assign(ids, [name.trim()]);
  }
}
