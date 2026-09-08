/**
 * Plugin instance: owns the long-lived services and the shutdown teardown.
 * Everything Zotero-facing hangs off here; nothing in `src/core/` knows it exists.
 */
import { NotifierLoopGuard } from "./core/guard.js";
import { ReaderMenuAdapter } from "./adapters/contextMenu.js";
import { ReaderSelectionWatcher, StickyGroupRegistry } from "./adapters/reader.js";
import { CompositorToolkit } from "./adapters/toolkit.js";
import { ExportService } from "./modules/exportService.js";
import { GroupService } from "./modules/groupService.js";
import { NotifierService } from "./modules/notifier.js";
import { GroupsPanel } from "./modules/panel.js";
import { RestoreService } from "./modules/restoreService.js";
import { SnapshotStore } from "./modules/snapshotStore.js";

export default class Addon {
  readonly data = {
    alive: true,
    initialized: false,
    rootURI: "",
  };

  readonly toolkit = new CompositorToolkit();
  readonly guard = new NotifierLoopGuard({ now: () => Date.now() });
  readonly sticky = new StickyGroupRegistry();
  readonly snapshots = new SnapshotStore();
  readonly service: GroupService;
  readonly exports: ExportService;
  readonly restores: RestoreService;
  readonly panel: GroupsPanel;
  readonly notifier: NotifierService;
  readonly readerMenu: ReaderMenuAdapter;
  readonly readerSelection: ReaderSelectionWatcher;

  constructor(
    build: (addon: Addon) => {
      panel: GroupsPanel;
      notifier: NotifierService;
      readerMenu: ReaderMenuAdapter;
    },
  ) {
    this.service = new GroupService(this.guard, this.snapshots);
    this.exports = new ExportService(this.service);
    this.restores = new RestoreService(this.service);
    const built = build(this);
    this.panel = built.panel;
    this.notifier = built.notifier;
    this.readerMenu = built.readerMenu;
    this.readerSelection = new ReaderSelectionWatcher((attachmentID, annotationKey) =>
      this.panel.handleExternalSelection(attachmentID, annotationKey),
    );
  }
}
