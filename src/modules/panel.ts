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
import { FLAT_SEPARATOR } from "../core/menuModel.js";
import {
  assignAnnotations,
  deleteFolder,
  renameFolder,
  reparentFolder,
  unassignAnnotations,
} from "../core/rewrite.js";
import type { AnnotationRecord, FolderNode, FolderPath, UiState } from "../core/types.js";
import { confirm, promptText } from "../adapters/dialogs.js";
import { openPopupMenu } from "../adapters/popupMenu.js";
import { openAndNavigate } from "../adapters/reader.js";
import type { StickyGroupRegistry } from "../adapters/reader.js";
import type { GroupService } from "./groupService.js";
import {
  getNavigateOnClick,
  getSelectionColor,
  getTagPrefix,
  getUseCustomSelectionColor,
} from "./prefs.js";

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
  /** Annotation ids in rendered order, for shift-click range selection. */
  visibleOrder: string[];
  /** Shift-click range anchor: the last annotation clicked without a modifier. */
  lastClickedId: string | null;
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
        icon: "chrome://annotationcompositor/content/icons/icon-16.svg",
      },
      sidenav: {
        l10nID: "annotationcompositor-section-header",
        icon: "chrome://annotationcompositor/content/icons/icon-20.svg",
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

  /**
   * A reader reported that `annotationKey` (on `attachmentID`) became its
   * selection — from a click on the highlight in the text or in Zotero's own
   * native sidebar. If that annotation belongs to the item currently shown,
   * select and scroll to its row here too.
   */
  handleExternalSelection(attachmentID: number, annotationKey: string): void {
    if (this.lastBody === null) {
      return;
    }
    const { body, item } = this.lastBody;
    if (!body.isConnected) {
      return;
    }
    const set = this.host.service.load(item);
    const belongs = set.attachments.some((attachment) => attachment.id === attachmentID);
    if (!belongs || !set.itemsByKey.has(annotationKey)) {
      return;
    }
    const state = this.state(item.key);
    if (state.selection.size === 1 && state.selection.has(annotationKey)) {
      return;
    }
    state.selection.clear();
    state.selection.add(annotationKey);
    state.lastClickedId = annotationKey;
    this.render(body, item);
    body
      .querySelector<HTMLElement>(
        `.ac-annotation[data-id="${CSS.escape(annotationKey)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
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
        visibleOrder: [],
        lastClickedId: null,
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

  /**
   * Annotation ids in the order their rows will be built — mirrors
   * `buildFolder`/`buildUngrouped` exactly (child folders before a folder's
   * own annotations, collapsed subtrees skipped) so shift-click ranges match
   * what is on screen.
   */
  private renderOrder(
    folders: readonly FolderNode[],
    ungrouped: readonly AnnotationRecord[],
  ): string[] {
    const order: string[] = [];
    const walk = (nodes: readonly FolderNode[]): void => {
      for (const node of nodes) {
        walk(node.children);
        if (!node.collapsed) {
          order.push(...node.annotationIds);
        }
      }
    };
    walk(folders);
    order.push(...ungrouped.map((annotation) => annotation.id));
    return order;
  }

  /** Shift-click: select the contiguous range from the last anchor to `id`. */
  private extendSelection(state: PanelState, id: string): void {
    const anchor = state.lastClickedId;
    const from = anchor === null ? -1 : state.visibleOrder.indexOf(anchor);
    const to = state.visibleOrder.indexOf(id);
    if (from === -1 || to === -1) {
      state.selection.clear();
      state.selection.add(id);
      return;
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    state.selection.clear();
    for (let i = start; i <= end; i += 1) {
      state.selection.add(state.visibleOrder[i]);
    }
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
    if (getUseCustomSelectionColor()) {
      body.style.setProperty("--ac-selection-color", getSelectionColor());
    } else {
      body.style.removeProperty("--ac-selection-color");
    }
    const records = this.host.service.load(item).records;
    const model = buildViewModel(records, prefix, this.uiState(state));
    state.visibleOrder = this.renderOrder(model.folders, model.ungrouped);

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

    // A folder can be collapsed whenever it hides something — its own
    // annotations count no less than a subfolder's — so leaf folders (direct
    // annotations, no child folders) get a working twisty too.
    const canToggle = folder.hasChildren || folder.directCount > 0;
    const twisty = doc.createElement("span");
    twisty.className = "ac-twisty";
    twisty.textContent = canToggle ? (folder.collapsed ? "›" : "⌄") : "";
    if (canToggle) {
      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.collapsedKeys.has(folder.key)) {
          state.collapsedKeys.delete(folder.key);
        } else {
          state.collapsedKeys.add(folder.key);
        }
        this.refresh();
      });
    }

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
      this.folderMenu(doc, event, item, state, folder);
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
      const range = event.shiftKey;
      const toggle = event.ctrlKey || event.metaKey;
      if (range) {
        this.extendSelection(state, annotation.id);
      } else if (toggle) {
        if (state.selection.has(annotation.id)) {
          state.selection.delete(annotation.id);
        } else {
          state.selection.add(annotation.id);
        }
        state.lastClickedId = annotation.id;
      } else {
        state.selection.clear();
        state.selection.add(annotation.id);
        state.lastClickedId = annotation.id;
      }
      this.refresh();
      if (!range && !toggle && getNavigateOnClick()) {
        void this.navigateAlways(item, annotation.id);
      }
    });
    row.addEventListener("dblclick", () => {
      ztoolkit.copyText(this.clipboardText(annotation));
      ztoolkit.notify("Annotation Compositor", "Copied to clipboard.");
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.annotationMenu(doc, event, item, state, annotation);
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

  /** Right-click on an annotation: add it (and the rest of the selection) to an existing folder. */
  private annotationMenu(
    doc: Document,
    event: MouseEvent,
    item: Zotero.Item,
    state: PanelState,
    annotation: AnnotationRecord,
  ): void {
    const ids = state.selection.has(annotation.id)
      ? [...state.selection].filter((id) => !id.startsWith("folder:"))
      : [annotation.id];
    const records = this.host.service.load(item).records;
    const paths = collectExistingPaths(records, getTagPrefix());
    if (paths.length === 0) {
      this.error("No folders exist yet for this item.");
      return;
    }
    openPopupMenu(
      doc,
      event,
      paths.map((path) => ({
        label: path.join(FLAT_SEPARATOR),
        onCommand: () => void this.assignToFolder(item, state, ids, path),
      })),
    );
  }

  private async assignToFolder(
    item: Zotero.Item,
    state: PanelState,
    ids: readonly string[],
    target: FolderPath,
  ): Promise<void> {
    const outcome = await this.host.service.mutate(item, "pre-assign", (recs, prefix) =>
      assignAnnotations(recs, prefix, ids, target, { mode: "add" }),
    );
    this.noteRecent(state, pathKey(target));
    this.report(outcome);
    this.refresh();
  }

  /** Plain-text clipboard payload for one annotation: its text, its comment, or both. */
  private clipboardText(annotation: AnnotationRecord): string {
    return [annotation.text, annotation.comment].filter((part) => part.length > 0).join("\n\n");
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

  private folderMenu(
    doc: Document,
    event: MouseEvent,
    item: Zotero.Item,
    state: PanelState,
    folder: FolderNode,
  ): void {
    openPopupMenu(doc, event, [
      { label: "Rename…", onCommand: () => void this.renameFolder(item, folder.path) },
      {
        label: "New subfolder…",
        onCommand: () => void this.createFolder(item, state, folder.path),
      },
      { label: "Delete folder", onCommand: () => void this.deleteFolder(item, folder.path) },
      { label: "Pin as sticky group", onCommand: () => this.setSticky(folder.path) },
      { label: "Clear sticky group", onCommand: () => this.setSticky(null) },
    ]);
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
