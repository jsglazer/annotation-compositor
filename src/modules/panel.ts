/**
 * The "Groups" item-pane section.
 *
 * Rendering is a pure `buildViewModel(...)` call followed by a single
 * DocumentFragment swap — no incremental DOM patching, no virtualisation.
 * Collapsed subtrees are absent from the view model, so they cost nothing.
 * All decision logic lives in `src/core/`; this file only turns plain objects
 * into elements and turns events back into core calls.
 *
 * Two invariants worth knowing before editing:
 *
 *  - Zotero renders this section into MORE THAN ONE body (the library item pane
 *    and the reader's context pane each get their own). Every live body is
 *    tracked with the item Zotero last handed it, so a refresh can never paint
 *    one item's folders into a pane showing another item.
 *  - A plain selection change must NOT re-render. Replacing the row mid-gesture
 *    is what stopped `dblclick` from ever firing.
 */
import { buildViewModel, collectExistingPaths, collectFolderKeys } from "../core/tree.js";
import { keyToPath, pathKey, remapKeys, validateFolderName } from "../core/path.js";
import { FLAT_SEPARATOR } from "../core/menuModel.js";
import {
  assignAnnotations,
  deleteFolder,
  renameFolder,
  reparentFolder,
  unassignAnnotations,
} from "../core/rewrite.js";
import { ANNOTATION_TYPES, TAG_TYPE_AUTOMATIC } from "../core/types.js";
import type { AnnotationRecord, FolderNode, FolderPath, UiState } from "../core/types.js";
import { resolveColorLabel } from "../core/colorNames.js";
import { confirm, promptText, promptTextChecked } from "../adapters/dialogs.js";
import { getCustomColorLabels } from "../adapters/colorLabels.js";
import { openPopupMenu } from "../adapters/popupMenu.js";
import { openAndNavigate } from "../adapters/reader.js";
import type { StickyGroupRegistry } from "../adapters/reader.js";
import type { GroupService } from "./groupService.js";
import {
  getNavigateOnClick,
  getSelectionColor,
  getStickyOnCreate,
  getTagPrefix,
  getUseCustomSelectionColor,
} from "./prefs.js";

export const SECTION_ID = "annotation-compositor-groups";
const STYLESHEET_URL = "chrome://annotationcompositor/content/annotation-compositor.css";
const DRAG_MIME = "application/x-annotation-compositor";

/**
 * Collapse key for the derived Ungrouped bucket. A real folder key is path
 * segments joined by "/", and segments are non-empty after trimming, so no
 * folder can ever produce a key starting with the separator.
 */
const UNGROUPED_KEY = "/ungrouped";

/** How long a single click waits to see whether it is really a double click. */
const DOUBLE_CLICK_MS = 260;

/** One-character type marks, so highlight and underline are told apart at a glance. */
const TYPE_MARKS: Readonly<Record<string, string>> = {
  highlight: "▮",
  underline: "▁",
  note: "✎",
  image: "▣",
  ink: "✐",
  text: "T",
};

interface PanelState {
  collapsedKeys: Set<string>;
  pendingFolderKeys: Set<string>;
  filter: string;
  /** Annotation types to show; empty means every type. */
  types: Set<string>;
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

/** One place Zotero has rendered the section, plus the item it belongs to. */
interface LiveBody {
  readonly body: HTMLElement;
  item: Zotero.Item;
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
  /** Every body Zotero has rendered into, newest last. Pruned on each refresh. */
  private bodies: LiveBody[] = [];
  /** Pending single-click navigation, cancelled when a double click arrives. */
  private clickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: PanelHost) {}

  /** Folder keys the user touched most recently, for the reader context menu. */
  recentsFor(item: Zotero.Item): string[] {
    return [...this.state(item.key).recents];
  }

  /**
   * Every folder path that can be assigned to for `item`: the ones backed by a
   * tag PLUS the empty folders the user just created, which have no tag yet and
   * were therefore missing from every menu until something was moved into them.
   */
  pathsFor(item: Zotero.Item): FolderPath[] {
    const records = this.host.service.load(item).records;
    const keys = new Set(collectExistingPaths(records, getTagPrefix()).map(pathKey));
    for (const key of this.state(item.key).pendingFolderKeys) {
      keys.add(key);
    }
    return [...keys].sort().map(keyToPath);
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
        this.trackBody(body, item);
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
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
    this.stateByItem.clear();
    this.bodies = [];
  }

  /**
   * Remember (or re-point) a rendered body. Zotero reuses the same element when
   * the selected item changes, so the item is updated in place rather than
   * appended — otherwise a later refresh would render the previous item's
   * folders into a pane now showing a different one.
   */
  private trackBody(body: HTMLElement, item: Zotero.Item): void {
    this.bodies = this.bodies.filter((entry) => entry.body.isConnected);
    const existing = this.bodies.find((entry) => entry.body === body);
    if (existing === undefined) {
      this.bodies.push({ body, item });
    } else {
      existing.item = item;
    }
  }

  /** Re-render every panel currently on screen (notifier-driven). */
  refresh(): void {
    this.bodies = this.bodies.filter((entry) => entry.body.isConnected);
    for (const entry of this.bodies) {
      this.render(entry.body, entry.item);
    }
  }

  /** The live bodies showing `item`, for in-place updates. */
  private bodiesFor(item: Zotero.Item): HTMLElement[] {
    return this.bodies
      .filter((entry) => entry.body.isConnected && entry.item.key === item.key)
      .map((entry) => entry.body);
  }

  /**
   * A reader reported that `annotationKey` (on `attachmentID`) became its
   * selection — from a click on the highlight in the text or in Zotero's own
   * native sidebar. If that annotation belongs to a displayed item, select and
   * scroll to its row here too.
   */
  handleExternalSelection(attachmentID: number, annotationKey: string): void {
    this.bodies = this.bodies.filter((entry) => entry.body.isConnected);
    for (const { body, item } of [...this.bodies]) {
      const set = this.host.service.load(item);
      const belongs = set.attachments.some(
        (attachment) => attachment.id === attachmentID,
      );
      if (!belongs || !set.itemsByKey.has(annotationKey)) {
        continue;
      }
      const state = this.state(item.key);
      if (state.selection.size === 1 && state.selection.has(annotationKey)) {
        continue;
      }
      state.selection.clear();
      state.selection.add(annotationKey);
      state.lastClickedId = annotationKey;
      this.applySelection(body, state);
      body
        .querySelector<HTMLElement>(
          `.ac-annotation[data-id="${CSS.escape(annotationKey)}"]`,
        )
        ?.scrollIntoView({ block: "nearest" });
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
        types: new Set<string>(),
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
      types: [...state.types],
    };
  }

  /**
   * Move every UI-state key that names `source` (or something below it) onto
   * `target`. Called after a rename or reparent so collapse state, pending
   * empty folders and the recents list follow the folder instead of being
   * orphaned — an orphaned collapse key is why a renamed folder sprang open and
   * why its twisty then stopped responding.
   */
  private remapState(state: PanelState, source: FolderPath, target: FolderPath): void {
    state.collapsedKeys = new Set(remapKeys(state.collapsedKeys, source, target));
    state.pendingFolderKeys = new Set(remapKeys(state.pendingFolderKeys, source, target));
    state.recents = remapKeys(state.recents, source, target);
    const sourceKey = `folder:${pathKey(source)}`;
    if (state.selection.delete(sourceKey)) {
      state.selection.add(`folder:${pathKey(target)}`);
    }
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
    ungroupedCollapsed: boolean,
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
    if (!ungroupedCollapsed) {
      order.push(...ungrouped.map((annotation) => annotation.id));
    }
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

  private toggleCollapse(state: PanelState, key: string): void {
    if (state.collapsedKeys.has(key)) {
      state.collapsedKeys.delete(key);
    } else {
      state.collapsedKeys.add(key);
    }
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
    const ungroupedCollapsed = state.collapsedKeys.has(UNGROUPED_KEY);
    state.visibleOrder = this.renderOrder(
      model.folders,
      model.ungrouped,
      ungroupedCollapsed,
    );

    // Single DocumentFragment swap: the whole panel is built off-document and
    // installed in one operation, so the reader never sees a partial tree.
    const fragment = doc.createDocumentFragment();
    fragment.append(this.buildToolbar(doc, item, state, records));

    const list = doc.createElement("div");
    list.className = "ac-tree";
    for (const folder of model.folders) {
      list.append(this.buildFolder(doc, item, state, folder, model.annotationsById));
    }
    list.append(
      this.buildUngrouped(doc, item, state, model.ungrouped, ungroupedCollapsed),
    );
    // Dropping on the empty space below the tree moves a folder to the top level.
    this.makeDropTarget(list, item, state, []);
    fragment.append(list);

    body.replaceChildren(fragment);
  }

  /**
   * Paint the current selection without rebuilding the tree. A full re-render
   * on every click destroys the row the gesture started on, which suppressed
   * `dblclick` entirely and cut drags short.
   */
  private applySelection(body: HTMLElement, state: PanelState): void {
    const rows = (selector: string): HTMLElement[] =>
      Array.from(body.querySelectorAll(selector)) as HTMLElement[];
    for (const row of rows(".ac-annotation")) {
      row.classList.toggle("ac-selected", state.selection.has(row.dataset.id ?? ""));
    }
    for (const row of rows(".ac-folder-row[data-key]")) {
      row.classList.toggle(
        "ac-selected",
        state.selection.has(`folder:${row.dataset.key ?? ""}`),
      );
    }
  }

  /** Repaint selection in every pane showing this item. */
  private refreshSelection(item: Zotero.Item, state: PanelState): void {
    for (const body of this.bodiesFor(item)) {
      this.applySelection(body, state);
    }
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
        state.collapsedKeys = new Set([
          ...collectFolderKeys(model.folders),
          UNGROUPED_KEY,
        ]);
        this.refresh();
      }),
      button("⤓", "Export selected folders", () => {
        void this.host.exportItem(item, this.selectedFolderPaths(state, records));
      }),
      button("⟲", "Restore previous grouping", () => {
        void this.host.restoreItem(item);
      }),
      button("⇌", "Convert this item's group tags to Automatic", () => {
        void this.convertToAutomatic(item);
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
    bar.append(filter, this.buildTypeFilter(doc, state));
    return bar;
  }

  /**
   * Annotation-type filter. Highlights and underlines look alike once they are
   * reduced to a row of text, so this is the way to look at one kind at a time;
   * each row also carries a type mark for the same reason.
   */
  private buildTypeFilter(doc: Document, state: PanelState): HTMLElement {
    const select = doc.createElement("select");
    select.className = "ac-typefilter";
    select.title = "Show only one annotation type";

    const option = (value: string, label: string): HTMLOptionElement => {
      const element = doc.createElement("option");
      element.value = value;
      element.textContent = label;
      return element;
    };
    select.append(option("", "All types"));
    for (const type of ANNOTATION_TYPES) {
      const label = `${TYPE_MARKS[type] ?? ""} ${type[0].toUpperCase()}${type.slice(1)}`;
      select.append(option(type, label.trim()));
    }
    select.value = state.types.size === 1 ? [...state.types][0] : "";
    select.addEventListener("change", () => {
      state.types = select.value.length === 0 ? new Set() : new Set([select.value]);
      this.refresh();
    });
    return select;
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
    row.dataset.key = folder.key;
    row.setAttribute("draggable", "true");

    // A folder can be collapsed whenever it hides something — its own
    // annotations count no less than a subfolder's — so leaf folders (direct
    // annotations, no child folders) get a working twisty too.
    const canToggle = folder.hasChildren || folder.directCount > 0;
    row.append(this.buildTwisty(doc, state, folder.key, canToggle, folder.collapsed));

    const name = doc.createElement("span");
    name.className = "ac-folder-name";
    name.textContent = folder.name;
    row.append(name);

    // The sticky folder is where new annotations in this reader tab land, so it
    // is worth marking rather than leaving to memory.
    if (pathKey(this.host.sticky.active() ?? []) === folder.key) {
      const pin = doc.createElement("span");
      pin.className = "ac-sticky";
      pin.textContent = "📌";
      pin.title = "New annotations in this tab are filed here";
      row.append(pin);
    }

    const swatches = doc.createElement("span");
    swatches.className = "ac-swatches";
    for (const color of folder.colors.slice(0, 5)) {
      const dot = doc.createElement("span");
      dot.className = "ac-swatch";
      dot.style.backgroundColor = color;
      swatches.append(dot);
    }

    const count = doc.createElement("span");
    count.className = "ac-count";
    count.textContent = String(folder.totalCount);

    row.append(swatches, count);
    row.addEventListener("click", () => {
      const key = `folder:${folder.key}`;
      if (state.selection.has(key)) {
        state.selection.delete(key);
      } else {
        state.selection.add(key);
      }
      this.refreshSelection(item, state);
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

  private buildTwisty(
    doc: Document,
    state: PanelState,
    key: string,
    canToggle: boolean,
    collapsed: boolean,
  ): HTMLElement {
    const twisty = doc.createElement("span");
    twisty.className = "ac-twisty";
    twisty.textContent = canToggle ? (collapsed ? "›" : "⌄") : "";
    if (canToggle) {
      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleCollapse(state, key);
        this.refresh();
      });
    }
    return twisty;
  }

  private buildUngrouped(
    doc: Document,
    item: Zotero.Item,
    state: PanelState,
    annotations: readonly AnnotationRecord[],
    collapsed: boolean,
  ): HTMLElement {
    const container = doc.createElement("div");
    container.className = "ac-folder ac-ungrouped";

    const row = doc.createElement("div");
    row.className = "ac-folder-row";
    row.append(
      this.buildTwisty(doc, state, UNGROUPED_KEY, annotations.length > 0, collapsed),
    );
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
    if (!collapsed) {
      for (const annotation of annotations) {
        children.append(this.buildAnnotation(doc, item, state, annotation, null));
      }
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

    const mark = doc.createElement("span");
    mark.className = "ac-type";
    mark.textContent = TYPE_MARKS[annotation.type.toLowerCase()] ?? "•";
    mark.title = annotation.type;

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

    row.append(swatch, mark, text, page);

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
      // Selection only — repainting classes keeps this row alive so the second
      // half of a double click still lands on it.
      this.refreshSelection(item, state);
      if (!range && !toggle && getNavigateOnClick()) {
        this.scheduleNavigate(item, annotation.id);
      }
    });
    row.addEventListener("dblclick", () => {
      this.cancelNavigate();
      void (async () => {
        ztoolkit.copyText(await this.clipboardText(annotation));
        ztoolkit.notify("Annotation Compositor", "Copied to clipboard.");
      })();
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

  /**
   * Hold the jump-to-annotation briefly: a double click is two clicks, and
   * navigating on the first one would fight the copy the second one triggers.
   */
  private scheduleNavigate(item: Zotero.Item, annotationKey: string): void {
    this.cancelNavigate();
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      void this.navigateAlways(item, annotationKey);
    }, DOUBLE_CLICK_MS);
  }

  private cancelNavigate(): void {
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  /** Right-click on an annotation: add it (and the rest of the selection) to a folder. */
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
    // Includes folders created in this session that hold nothing yet — they
    // have no tag, so a tag-only listing left them out of this menu entirely.
    const paths = this.pathsFor(item);
    const items = paths.map((path) => ({
      label: path.join(FLAT_SEPARATOR),
      onCommand: () => void this.assignToFolder(item, state, ids, path),
    }));
    openPopupMenu(doc, event, [
      ...items,
      {
        label: paths.length > 0 ? "New folder…" : "New folder… (no folders yet)",
        onCommand: () => void this.createFolder(item, state, [], ids),
      },
    ]);
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

  /**
   * Plain-text clipboard payload for one annotation:
   * `{annotated text} ({Color}: {page})`, followed by the comment (if any)
   * on its own paragraph. `{Color}` is the Enhanced Notes custom label for
   * the annotation's color when one is set, else Zotero's built-in name.
   */
  private async clipboardText(annotation: AnnotationRecord): Promise<string> {
    const primary =
      annotation.text.length > 0
        ? annotation.text
        : annotation.comment.length > 0
          ? annotation.comment
          : `(${annotation.type})`;
    const colorLabel = resolveColorLabel(annotation.color, await getCustomColorLabels());
    const suffix =
      annotation.pageLabel.length > 0
        ? `${colorLabel}: ${annotation.pageLabel}`
        : colorLabel;
    const line = `${primary} (${suffix})`;
    return annotation.text.length > 0 && annotation.comment.length > 0
      ? `${line}\n\n${annotation.comment}`
      : line;
  }

  private async navigateAlways(item: Zotero.Item, annotationKey: string): Promise<void> {
    const annotation = this.host.service.load(item).itemsByKey.get(annotationKey);
    if (annotation === undefined) {
      return;
    }
    if (!(await openAndNavigate(annotation))) {
      this.error("Could not open the annotation in a reader.");
    }
  }

  private startDrag(event: DragEvent, payload: DragPayload): void {
    const transfer = event.dataTransfer;
    if (transfer === null) {
      return;
    }
    const raw = JSON.stringify(payload);
    transfer.setData(DRAG_MIME, raw);
    // Gecko will not start a drag whose DataTransfer carries only an unknown
    // custom type; the plain-text copy makes the drag valid and doubles as the
    // read-back path when the custom type does not survive the drop.
    transfer.setData("text/plain", raw);
    transfer.effectAllowed = "copyMove";
  }

  /** Read a drag payload back, tolerating the loss of the custom MIME type. */
  private readDrag(event: DragEvent): DragPayload | null {
    const transfer = event.dataTransfer;
    if (transfer === null) {
      return null;
    }
    const raw = transfer.getData(DRAG_MIME) || transfer.getData("text/plain");
    if (raw.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<DragPayload>;
      return Array.isArray(parsed.ids) &&
        (parsed.folderKey === null || typeof parsed.folderKey === "string")
        ? {
            ids: parsed.ids,
            sourceKey: typeof parsed.sourceKey === "string" ? parsed.sourceKey : null,
            folderKey: parsed.folderKey ?? null,
          }
        : null;
    } catch {
      // Something else was dropped on the panel (a file, a Zotero item, text).
      return null;
    }
  }

  private makeDropTarget(
    row: HTMLElement,
    item: Zotero.Item,
    state: PanelState,
    target: FolderPath,
  ): void {
    // dragenter/dragleave also fire when the pointer crosses a child element,
    // so the highlight is reference-counted instead of toggled.
    let depth = 0;
    const clear = (): void => {
      depth = 0;
      row.classList.remove("ac-droptarget");
    };
    row.addEventListener("dragenter", (event) => {
      event.preventDefault();
      depth += 1;
      row.classList.add("ac-droptarget");
    });
    row.addEventListener("dragover", (event) => {
      // Without preventDefault on every dragover Gecko refuses the drop
      // outright, which is what made folder-onto-folder nesting a no-op.
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = this.isAddModifier(event) ? "copy" : "move";
      }
      row.classList.add("ac-droptarget");
    });
    row.addEventListener("dragleave", () => {
      depth -= 1;
      if (depth <= 0) {
        clear();
      }
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clear();
      const payload = this.readDrag(event);
      if (payload !== null) {
        void this.handleDrop(item, state, payload, target, this.isAddModifier(event));
      }
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
      await this.moveFolder(item, state, keyToPath(payload.folderKey), target);
      return;
    }
    if (payload.ids.length === 0) {
      return;
    }
    if (target.length === 0) {
      // Annotations dropped on the tree background have nowhere to go.
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
    // The destination now holds something, so it is no longer a pending folder.
    state.pendingFolderKeys.delete(pathKey(target));
    this.report(outcome);
    this.refresh();
  }

  /**
   * Reparent `source` under `newParent` (`[]` = top level), which is how a
   * folder becomes a subfolder of another. A folder that exists only in UI
   * state has no tags to rewrite, so it is moved in UI state alone.
   */
  private async moveFolder(
    item: Zotero.Item,
    state: PanelState,
    source: FolderPath,
    newParent: FolderPath,
  ): Promise<void> {
    const target = [...newParent, source[source.length - 1]];
    if (pathKey(target) === pathKey(source)) {
      return;
    }
    const outcome = await this.host.service.mutate(
      item,
      "pre-reparent",
      (records, prefix) => reparentFolder(records, prefix, source, newParent),
    );
    if (!outcome.ok) {
      this.report(outcome);
      return;
    }
    this.remapState(state, source, target);
    this.refresh();
  }

  private folderMenu(
    doc: Document,
    event: MouseEvent,
    item: Zotero.Item,
    state: PanelState,
    folder: FolderNode,
  ): void {
    const isSticky = pathKey(this.host.sticky.active() ?? []) === folder.key;
    // Every folder except this one and its own descendants is a legal new
    // parent; "Top level" un-nests. This is the menu-driven twin of dragging a
    // folder onto another folder.
    const destinations = this.pathsFor(item).filter(
      (path) =>
        pathKey(path) !== folder.key && !pathKey(path).startsWith(`${folder.key}/`),
    );
    openPopupMenu(doc, event, [
      {
        label: "Rename…",
        onCommand: () => void this.renameFolder(item, state, folder.path),
      },
      {
        label: "New subfolder…",
        onCommand: () => void this.createFolder(item, state, folder.path),
      },
      {
        label: "Move to top level",
        disabled: folder.path.length === 1,
        onCommand: () => void this.moveFolder(item, state, folder.path, []),
      },
      ...destinations.map((path) => ({
        label: `Move into: ${path.join(FLAT_SEPARATOR)}`,
        onCommand: () => void this.moveFolder(item, state, folder.path, path),
      })),
      {
        label: "Delete folder",
        onCommand: () => void this.deleteFolder(item, folder.path),
      },
      {
        label: isSticky ? "Unpin sticky group" : "Pin as sticky group",
        onCommand: () => this.setSticky(isSticky ? null : folder.path),
      },
    ]);
  }

  private setSticky(path: FolderPath | null): void {
    const tabs = Zotero.getMainWindow()?.Zotero_Tabs;
    if (typeof tabs?.selectedID === "string") {
      this.host.sticky.set(tabs.selectedID, path);
      this.refresh();
    }
  }

  /**
   * Create a folder. `assignIds`, when given, are filed into it immediately —
   * which is also what makes the folder real, since an empty folder has no tag.
   */
  private async createFolder(
    item: Zotero.Item,
    state: PanelState,
    parent: FolderPath,
    assignIds: readonly string[] = [],
  ): Promise<void> {
    const answer = promptTextChecked(
      "New folder",
      "Folder name:",
      "",
      "Pin as this tab's sticky folder",
      getStickyOnCreate(),
    );
    if (answer === null) {
      return;
    }
    const check = validateFolderName(answer.value);
    if (!check.ok || check.value === undefined) {
      this.error(check.error ?? "Invalid folder name.");
      return;
    }
    const path = [...parent, check.value];
    const key = pathKey(path);
    if (answer.checked) {
      this.setSticky(path);
    }
    if (assignIds.length > 0) {
      await this.assignToFolder(item, state, assignIds, path);
      return;
    }
    // An empty folder cannot exist as a tag, so it lives in UI state until the
    // first annotation is assigned to it.
    state.pendingFolderKeys.add(key);
    this.noteRecent(state, key);
    this.refresh();
  }

  private async renameFolder(
    item: Zotero.Item,
    state: PanelState,
    path: FolderPath,
  ): Promise<void> {
    const raw = promptText("Rename folder", "Folder name:", path[path.length - 1]);
    if (raw === null) {
      return;
    }
    const check = validateFolderName(raw);
    if (!check.ok || check.value === undefined) {
      this.error(check.error ?? "Invalid folder name.");
      return;
    }
    const target = [...path.slice(0, -1), check.value];
    const outcome = await this.host.service.mutate(
      item,
      "pre-rename",
      (records, prefix) => renameFolder(records, prefix, path, check.value as string),
    );
    if (!outcome.ok) {
      this.report(outcome);
      return;
    }
    // Carry collapse state onto the new key, so a collapsed folder stays
    // collapsed instead of springing open under its new name.
    this.remapState(state, path, target);
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
    const prefix = pathKey(path);
    for (const key of [...state.pendingFolderKeys]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        state.pendingFolderKeys.delete(key);
      }
    }
    for (const key of [...state.collapsedKeys]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        state.collapsedKeys.delete(key);
      }
    }
    const outcome = await this.host.service.mutate(item, "pre-delete", (records, p) =>
      deleteFolder(records, p, path),
    );
    this.report(outcome);
    this.refresh();
  }

  /**
   * Rewrite every existing group tag on `item` from Manual to Automatic.
   * Snapshot-backed like every other write, so "Restore previous grouping"
   * can undo it.
   */
  private async convertToAutomatic(item: Zotero.Item): Promise<void> {
    if (
      !confirm(
        "Convert to Automatic",
        'Convert this item\'s existing group tags from Manual to Automatic? A snapshot is taken first, and "Restore previous grouping" can undo it.',
      )
    ) {
      return;
    }
    const outcome = await this.host.service.rewriteTagType(item, TAG_TYPE_AUTOMATIC);
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
