/**
 * The "Groups" item-pane section.
 *
 * Rendering is a pure `buildViewModel(...)` call followed by a single
 * DocumentFragment swap — no incremental DOM patching, no virtualisation.
 * Collapsed subtrees are absent from the view model, so they cost nothing.
 * All decision logic lives in `src/core/`; this file only turns plain objects
 * into elements and turns events back into core calls.
 */
import { buildViewModel, collectExistingPaths, collectFolderKeys } from "../core/tree.js";
import { keyToPath, pathKey, validateFolderName } from "../core/path.js";
import {
  assignAnnotations,
  deleteFolder,
  renameFolder,
  reparentFolder,
  unassignAnnotations,
} from "../core/rewrite.js";
import type { AnnotationRecord, FolderNode, FolderPath, UiState } from "../core/types.js";
import { confirm, promptText, select } from "../adapters/dialogs.js";
import { navigateToAnnotation, openAndNavigate } from "../adapters/reader.js";
import type { StickyGroupRegistry } from "../adapters/reader.js";
import type { GroupService } from "./groupService.js";
import { getNavigateOnClick, getTagPrefix } from "./prefs.js";

const SECTION_ID = "annotation-compositor-groups";
const STYLESHEET_URL = "chrome://annotationcompositor/content/annotation-compositor.css";
const DRAG_MIME = "application/x-annotation-compositor";

interface PanelState {
  collapsedKeys: Set<string>;
  pendingFolderKeys: Set<string>;
  filter: string;
  selection: Set<string>;
  /** Folder keys used recently, most recent first (feeds the reader menu). */
  recents: string[];
}

interface DragPayload {
  readonly ids: string[];
  readonly sourceKey: string | null;
  readonly folderKey: string | null;
}

export interface PanelHost {
  readonly service: GroupService;
  readonly sticky: StickyGroupRegistry;
  /** Opens the export dialog for the given item. */
  exportItem(item: Zotero.Item, selectedPaths: FolderPath[]): Promise<void>;
  /** Opens the snapshot restore dialog. */
  restoreItem(item: Zotero.Item): Promise<void>;
}

export class GroupsPanel {
  private sectionKey: string | false = false;
  private readonly stateByItem = new Map<string, PanelState>();
  private lastBody: { body: HTMLElement; item: Zotero.Item } | null = null;

  constructor(private readonly host: PanelHost) {}

  /** Folder keys the user touched most recently, for the reader context menu. */
  recentsFor(item: Zotero.Item): string[] {
    return [...this.state(item.key).recents];
  }

  register(): void {
    if (this.sectionKey !== false) {
      return;
    }
    this.sectionKey = Zotero.ItemPaneManager.registerSection({
      paneID: SECTION_ID,
      pluginID: "annotation-compositor@jsglazer.com",
      header: {
        l10nID: "annotationcompositor-section-header",
        icon: "chrome://zotero/skin/16/universal/tag.svg",
      },
      sidenav: {
        l10nID: "annotationcompositor-section-header",
        icon: "chrome://zotero/skin/20/universal/tag.svg",
      },
      onRender: ({ body, item }) => {
        this.lastBody = { body, item };
        this.injectStylesheet(body.ownerDocument);
        this.render(body, item);
      },
      onItemChange: ({ item, setEnabled }) => {
        setEnabled(item.isRegularItem() || item.isAttachment());
      },
    });
  }

  unregister(): void {
    if (this.sectionKey !== false) {
      Zotero.ItemPaneManager.unregisterSection(SECTION_ID);
      this.sectionKey = false;
    }
    this.stateByItem.clear();
    this.lastBody = null;
  }

  /** Re-render the panel currently on screen, if any (notifier-driven). */
  refresh(): void {
    if (this.lastBody === null) {
      return;
    }
    const { body, item } = this.lastBody;
    if (body.isConnected) {
      this.render(body, item);
    }
  }

  /** Add the panel stylesheet once per document, tracked for shutdown removal. */
  private injectStylesheet(doc: Document): void {
    if (doc.querySelector("link[data-annotation-compositor]") !== null) {
      return;
    }
    const link = ztoolkit.createElement(doc, "link", {
      properties: { rel: "stylesheet", href: STYLESHEET_URL },
      attributes: { "data-annotation-compositor": "true" },
    });
    doc.documentElement.appendChild(link);
  }

  private state(itemKey: string): PanelState {
    let state = this.stateByItem.get(itemKey);
    if (state === undefined) {
      state = {
        collapsedKeys: new Set<string>(),
        pendingFolderKeys: new Set<string>(),
        filter: "",
        selection: new Set<string>(),
        recents: [],
      };
      this.stateByItem.set(itemKey, state);
    }
    return state;
  }

  private uiState(state: PanelState): UiState {
    return {
      collapsedKeys: [...state.collapsedKeys],
      pendingFolderKeys: [...state.pendingFolderKeys],
      filter: state.filter,
    };
  }

  private noteRecent(state: PanelState, key: string): void {
    state.recents = [key, ...state.recents.filter((existing) => existing !== key)].slice(
      0,
      8,
    );
  }

  // ---------------------------------------------------------------- rendering

  private render(body: HTMLElement, item: Zotero.Item): void {
    const doc = body.ownerDocument;
    const state = this.state(item.key);
    const prefix = getTagPrefix();
    const records = this.host.service.load(item).records;
    const model = buildViewModel(records, prefix, this.uiState(state));

    // Single DocumentFragment swap: the whole panel is built off-document and
    // installed in one operation, so the reader never sees a partial tree.
    const fragment = doc.createDocumentFragment();
    fragment.append(this.buildToolbar(doc, item, state, records));

    const list = doc.createElement("div");
    list.className = "ac-tree";
    for (const folder of model.folders) {
      list.append(this.buildFolder(doc, item, state, folder, model.annotationsById));
    }
    list.append(this.buildUngrouped(doc, item, state, model.ungrouped));
    fragment.append(list);

    body.replaceChildren(fragment);
  }

  private buildToolbar(
    doc: Document,
    item: Zotero.Item,
    state: PanelState,
    records: readonly AnnotationRecord[],
  ): HTMLElement {
    const bar = doc.createElement("div");
    bar.className = "ac-toolbar";

    const button = (label: string, title: string, onClick: () => void): HTMLElement => {
      const element = doc.createElement("button");
      element.className = "ac-button";
      element.textContent = label;
      element.title = title;
      element.addEventListener("click", onClick);
      return element;
    };

    bar.append(
      button("＋", "New folder", () => {
        void this.createFolder(item, state, []);
      }),
      button("⌄", "Expand all", () => {
        state.collapsedKeys.clear();
        this.refresh();
      }),
      button("›", "Collapse all", () => {
        const model = buildViewModel(records, getTagPrefix(), {
          pendingFolderKeys: [...state.pendingFolderKeys],
        });
        state.collapsedKeys = new Set(collectFolderKeys(model.folders));
        this.refresh();
      }),
      button("⤓", "Export selected folders", () => {
        void this.host.exportItem(item, this.selectedFolderPaths(state, records));
      }),
      button("⟲", "Restore previous grouping", () => {
        void this.host.restoreItem(item);
      }),
    );

    const filter = doc.createElement("input");
    filter.className = "ac-filter";
    filter.setAttribute("type", "search");
    filter.setAttribute("placeholder", "Filter");
    filter.value = state.filter;
    filter.addEventListener("input", () => {
      state.filter = filter.value;
      this.refresh();
    });
    bar.append(filter);
    return bar;
  }

  private selectedFolderPaths(
    state: PanelState,
    records: readonly AnnotationRecord[],
  ): FolderPath[] {
    const selected = [...state.selection]
      .filter((key) => key.startsWith("folder:"))
      .map((key) => keyToPath(key.slice("folder:".length)));
    return selected.length > 0 ? selected : collectExistingPaths(records, getTagPrefix());
  }

  private buildFolder(
    doc: Document,
    item: Zotero.Item,
    state: PanelState,
    folder: FolderNode,
    byId: Readonly<Record<string, AnnotationRecord>>,
  ): HTMLElement {
    const container = doc.createElement("div");
    container.className = "ac-folder";
    container.dataset.key = folder.key;

    const row = doc.createElement("div");
    row.className = "ac-folder-row";
    row.setAttribute("draggable", "true");

    const twisty = doc.createElement("span");
    twisty.className = "ac-twisty";
    twisty.textContent = folder.hasChildren ? (folder.collapsed ? "›" : "⌄") : "";
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.collapsedKeys.has(folder.key)) {
        state.collapsedKeys.delete(folder.key);
      } else {
        state.collapsedKeys.add(folder.key);
      }
      this.refresh();
    });

    const name = doc.createElement("span");
    name.className = "ac-folder-name";
    name.textContent = folder.name;

    const count = doc.createElement("span");
    count.className = "ac-count";
    count.textContent = String(folder.totalCount);

    const swatches = doc.createElement("span");
    swatches.className = "ac-swatches";
    for (const color of folder.colors.slice(0, 5)) {
      const dot = doc.createElement("span");
      dot.className = "ac-swatch";
      dot.style.backgroundColor = color;
      swatches.append(dot);
    }

    row.append(twisty, name, swatches, count);
    row.addEventListener("click", () => {
      const key = `folder:${folder.key}`;
      if (state.selection.has(key)) {
        state.selection.delete(key);
      } else {
        state.selection.add(key);
      }
      this.refresh();
    });
    if (state.selection.has(`folder:${folder.key}`)) {
      row.classList.add("ac-selected");
    }
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void this.folderMenu(item, state, folder);
    });
    row.addEventListener("dragstart", (event) => {
      this.startDrag(event, { ids: [], sourceKey: null, folderKey: folder.key });
    });
    this.makeDropTarget(row, item, state, folder.path);

    container.append(row);

    const children = doc.createElement("div");
    children.className = "ac-children";
    for (const child of folder.children) {
      children.append(this.buildFolder(doc, item, state, child, byId));
    }
    if (!folder.collapsed) {
      for (const id of folder.annotationIds) {
        const annotation = byId[id];
        if (annotation !== undefined) {
          children.append(
            this.buildAnnotation(doc, item, state, annotation, folder.path),
          );
        }
      }
    }
    container.append(children);
    return container;
  }

  private buildUngrouped(
    doc: Document,
    item: Zotero.Item,
    state: PanelState,
    annotations: readonly AnnotationRecord[],
  ): HTMLElement {
    const container = doc.createElement("div");
    container.className = "ac-folder ac-ungrouped";

    const row = doc.createElement("div");
    row.className = "ac-folder-row";
    const name = doc.createElement("span");
    name.className = "ac-folder-name";
    // Derived at render time from the absence of a prefixed tag — never a tag.
    name.textContent = "Ungrouped";
    const count = doc.createElement("span");
    count.className = "ac-count";
    count.textContent = String(annotations.length);
    row.append(name, count);
    container.append(row);

    const children = doc.createElement("div");
    children.className = "ac-children";
    for (const annotation of annotations) {
      children.append(this.buildAnnotation(doc, item, state, annotation, null));
    }
    container.append(children);
    return container;
  }

  private buildAnnotation(
    doc: Document,
    item: Zotero.Item,
    state: PanelState,
    annotation: AnnotationRecord,
    folderPath: FolderPath | null,
  ): HTMLElement {
    const row = doc.createElement("div");
    row.className = "ac-annotation";
    row.dataset.id = annotation.id;
    row.setAttribute("draggable", "true");
    if (state.selection.has(annotation.id)) {
      row.classList.add("ac-selected");
    }

    const swatch = doc.createElement("span");
    swatch.className = "ac-swatch";
    swatch.style.backgroundColor = annotation.color;

    const text = doc.createElement("span");
    text.className = "ac-annotation-text";
    text.textContent =
      annotation.text.length > 0
        ? annotation.text
        : annotation.comment.length > 0
          ? annotation.comment
          : `(${annotation.type})`;

    const page = doc.createElement("span");
    page.className = "ac-page";
    page.textContent = annotation.pageLabel;

    row.append(swatch, text, page);

    row.addEventListener("click", (event) => {
      const multi = event.ctrlKey || event.metaKey || event.shiftKey;
      if (multi) {
        if (state.selection.has(annotation.id)) {
          state.selection.delete(annotation.id);
        } else {
          state.selection.add(annotation.id);
        }
      } else {
        state.selection.clear();
        state.selection.add(annotation.id);
      }
      this.refresh();
      if (!multi && getNavigateOnClick()) {
        this.navigate(item, annotation.id);
      }
    });
    row.addEventListener("dblclick", () => {
      // Always navigates, even when the click-to-navigate pref is off.
      void this.navigateAlways(item, annotation.id);
    });
    row.addEventListener("dragstart", (event) => {
      const ids = state.selection.has(annotation.id)
        ? [...state.selection].filter((id) => !id.startsWith("folder:"))
        : [annotation.id];
      this.startDrag(event, {
        ids,
        sourceKey: folderPath === null ? null : pathKey(folderPath),
        folderKey: null,
      });
    });
    return row;
  }

  // -------------------------------------------------------------- interaction

  private navigate(item: Zotero.Item, annotationKey: string): void {
    const annotation = this.host.service.load(item).itemsByKey.get(annotationKey);
    if (annotation !== undefined) {
      navigateToAnnotation(annotation);
    }
  }

  private async navigateAlways(item: Zotero.Item, annotationKey: string): Promise<void> {
    const annotation = this.host.service.load(item).itemsByKey.get(annotationKey);
    if (annotation !== undefined) {
      await openAndNavigate(annotation);
    }
  }

  private startDrag(event: DragEvent, payload: DragPayload): void {
    event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(payload));
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "copyMove";
    }
  }

  private makeDropTarget(
    row: HTMLElement,
    item: Zotero.Item,
    state: PanelState,
    target: FolderPath,
  ): void {
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = this.isAddModifier(event) ? "copy" : "move";
      }
      row.classList.add("ac-droptarget");
    });
    row.addEventListener("dragleave", () => row.classList.remove("ac-droptarget"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("ac-droptarget");
      const raw = event.dataTransfer?.getData(DRAG_MIME);
      if (raw === undefined || raw.length === 0) {
        return;
      }
      const payload = JSON.parse(raw) as DragPayload;
      void this.handleDrop(item, state, payload, target, this.isAddModifier(event));
    });
  }

  /** Command-drag on macOS, Alt-drag elsewhere: ADD without removing. */
  private isAddModifier(event: DragEvent): boolean {
    return Zotero.isMac ? event.metaKey : event.altKey;
  }

  private async handleDrop(
    item: Zotero.Item,
    state: PanelState,
    payload: DragPayload,
    target: FolderPath,
    addOnly: boolean,
  ): Promise<void> {
    if (payload.folderKey !== null) {
      // Dragging a folder node reparents that folder and its whole subtree.
      const source = keyToPath(payload.folderKey);
      const outcome = await this.host.service.mutate(
        item,
        "pre-reparent",
        (records, prefix) => reparentFolder(records, prefix, source, target),
      );
      this.report(outcome);
      this.refresh();
      return;
    }
    if (payload.ids.length === 0) {
      return;
    }
    // A drag out of the derived Ungrouped bucket has no source tag to remove,
    // so it is always an add.
    const sourcePath =
      payload.sourceKey === null ? undefined : keyToPath(payload.sourceKey);
    const outcome = await this.host.service.mutate(
      item,
      "pre-assign",
      (records, prefix) =>
        assignAnnotations(records, prefix, payload.ids, target, {
          mode: addOnly || sourcePath === undefined ? "add" : "move",
          sourcePath,
        }),
    );
    this.noteRecent(state, pathKey(target));
    this.report(outcome);
    this.refresh();
  }

  private async folderMenu(
    item: Zotero.Item,
    state: PanelState,
    folder: FolderNode,
  ): Promise<void> {
    const selected = select("Folder", folder.key, [
      "Rename…",
      "New subfolder…",
      "Delete folder",
      "Pin as sticky group",
      "Clear sticky group",
    ]);
    if (selected === null) {
      return;
    }
    switch (selected) {
      case 0:
        await this.renameFolder(item, folder.path);
        break;
      case 1:
        await this.createFolder(item, state, folder.path);
        break;
      case 2:
        await this.deleteFolder(item, folder.path);
        break;
      case 3:
        this.setSticky(folder.path);
        break;
      default:
        this.setSticky(null);
        break;
    }
  }

  private setSticky(path: FolderPath | null): void {
    const tabs = Zotero.getMainWindow()?.Zotero_Tabs;
    if (typeof tabs?.selectedID === "string") {
      this.host.sticky.set(tabs.selectedID, path);
    }
  }

  private promptForName(title: string, initial: string): string | null {
    return promptText(title, "Folder name:", initial);
  }

  private async createFolder(
    item: Zotero.Item,
    state: PanelState,
    parent: FolderPath,
  ): Promise<void> {
    const raw = this.promptForName("New folder", "");
    if (raw === null) {
      return;
    }
    const check = validateFolderName(raw);
    if (!check.ok || check.value === undefined) {
      this.error(check.error ?? "Invalid folder name.");
      return;
    }
    // An empty folder cannot exist as a tag, so it lives in UI state until the
    // first annotation is assigned to it.
    const key = pathKey([...parent, check.value]);
    state.pendingFolderKeys.add(key);
    this.noteRecent(state, key);
    this.refresh();
  }

  private async renameFolder(item: Zotero.Item, path: FolderPath): Promise<void> {
    const raw = this.promptForName("Rename folder", path[path.length - 1]);
    if (raw === null) {
      return;
    }
    const outcome = await this.host.service.mutate(
      item,
      "pre-rename",
      (records, prefix) => renameFolder(records, prefix, path, raw),
    );
    this.report(outcome);
    this.refresh();
  }

  private async deleteFolder(item: Zotero.Item, path: FolderPath): Promise<void> {
    if (
      !confirm(
        "Delete folder",
        `Remove "${pathKey(path)}" and its subfolders from every annotation on this item? The annotations themselves are not deleted.`,
      )
    ) {
      return;
    }
    const state = this.state(item.key);
    for (const key of [...state.pendingFolderKeys]) {
      if (key === pathKey(path) || key.startsWith(`${pathKey(path)}/`)) {
        state.pendingFolderKeys.delete(key);
      }
    }
    const outcome = await this.host.service.mutate(
      item,
      "pre-delete",
      (records, prefix) => deleteFolder(records, prefix, path),
    );
    this.report(outcome);
    this.refresh();
  }

  /** Remove selected annotations from one folder (used by the reader menu too). */
  async removeFromFolder(
    item: Zotero.Item,
    ids: readonly string[],
    path: FolderPath,
  ): Promise<void> {
    const outcome = await this.host.service.mutate(
      item,
      "pre-unassign",
      (records, prefix) => unassignAnnotations(records, prefix, ids, path),
    );
    this.report(outcome);
    this.refresh();
  }

  private report(outcome: { ok: boolean; error?: string; mutationCount: number }): void {
    if (!outcome.ok) {
      this.error(outcome.error ?? "The operation could not be completed.");
    }
  }

  private error(message: string): void {
    ztoolkit.notify("Annotation Compositor", message, false);
  }
}
