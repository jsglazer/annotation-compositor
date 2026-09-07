/**
 * Lifecycle hooks. This is the boundary where the Zotero globals enter the
 * plugin: everything below `src/core/` receives plain data instead.
 */
import { collectExistingPaths } from "./core/tree.js";
import { keyToPath } from "./core/path.js";
import type { FolderPath } from "./core/types.js";
import { assignAnnotations } from "./core/rewrite.js";
import { ReaderMenuAdapter } from "./adapters/contextMenu.js";
import { alert } from "./adapters/dialogs.js";
import { getAnnotationItems } from "./adapters/annotations.js";
import Addon from "./addon.js";
import { assignNewAnnotations } from "./modules/autoAssign.js";
import { NotifierService } from "./modules/notifier.js";
import { GroupsPanel } from "./modules/panel.js";
import {
  getPersistedStickyGroups,
  getTagPrefix,
  getWarningAcknowledged,
  setPersistedStickyGroups,
  setWarningAcknowledged,
} from "./modules/prefs.js";

let addon: Addon | null = null;

/** The item the reader context menu is acting on, resolved from an annotation. */
function itemForAnnotations(keys: readonly string[]): Zotero.Item | null {
  const libraryID = Zotero.Libraries.userLibraryID;
  for (const annotation of getAnnotationItems(libraryID, keys).values()) {
    const attachment = annotation.parentItem;
    if (attachment !== undefined) {
      return attachment.parentItem ?? attachment;
    }
  }
  return null;
}

function buildAddon(): Addon {
  return new Addon((self) => {
    const panel = new GroupsPanel({
      service: self.service,
      sticky: self.sticky,
      exportItem: (item, paths) => self.exports.run(item, paths),
      restoreItem: async (item) => {
        if (await self.restores.run(item)) {
          panel.refresh();
        }
      },
    });

    const readerMenu = new ReaderMenuAdapter({
      pathsFor: (keys): FolderPath[] => {
        const item = itemForAnnotations(keys);
        return item === null
          ? []
          : collectExistingPaths(self.service.load(item).records, getTagPrefix());
      },
      recentsFor: (keys): string[] => {
        const item = itemForAnnotations(keys);
        return item === null ? [] : panel.recentsFor(item);
      },
      assign: async (keys, path): Promise<void> => {
        const item = itemForAnnotations(keys);
        if (item === null) {
          return;
        }
        const outcome = await self.service.mutate(item, "pre-assign", (records, prefix) =>
          assignAnnotations(records, prefix, keys, path, { mode: "add" }),
        );
        if (!outcome.ok) {
          alert("Annotation Compositor", outcome.error ?? "Assignment failed.");
          return;
        }
        panel.refresh();
      },
    });

    const notifier = new NotifierService(self.guard, {
      onRefresh: () => panel.refresh(),
      onAnnotationsCreated: (annotations) =>
        assignNewAnnotations(self.service, self.sticky, annotations),
    });

    return { panel, notifier, readerMenu };
  });
}

/** Called from `bootstrap.js` once Zotero is ready. */
export async function onStartup(rootURI: string): Promise<void> {
  await Zotero.initializationPromise;
  addon = buildAddon();
  addon.data.rootURI = rootURI;
  // The toolkit facade is exposed as a sandbox global so UI code can reach it
  // without threading it through every constructor.
  (globalThis as unknown as { ztoolkit: Addon["toolkit"] }).ztoolkit = addon.toolkit;

  for (const [tabID, path] of Object.entries(getPersistedStickyGroups())) {
    addon.sticky.set(tabID, path as FolderPath);
  }

  addon.panel.register();
  addon.notifier.register();
  addon.readerMenu.register();
  addon.data.initialized = true;

  // Unregistered automatically by Zotero when the plugin shuts down.
  void Zotero.PreferencePanes.register({
    pluginID: "annotation-compositor@jsglazer.com",
    src: rootURI + "chrome/content/preferences.xhtml",
    label: "Annotation Compositor",
    image: "chrome://annotationcompositor/content/icons/icon-20.svg",
  });

  if (!getWarningAcknowledged()) {
    alert(
      "Annotation Compositor",
      [
        "Folder membership is stored as tags on your annotations.",
        "",
        'Zotero\'s "Delete Automatic Tags in This Library" command can remove tags in bulk. Group tags are stored as MANUAL tags by default, which that command does not touch; if you switch them to automatic tags, keep snapshots in mind.',
        "",
        "A snapshot is written before every change, and “Restore previous grouping” can put the structure back.",
      ].join("\n"),
    );
    setWarningAcknowledged(true);
  }
}

/** Called from `bootstrap.js` on disable/uninstall/app shutdown. */
export function onShutdown(): void {
  if (addon === null) {
    return;
  }
  setPersistedStickyGroups(addon.sticky.toJSON());
  addon.notifier.unregister();
  addon.readerMenu.unregister();
  addon.readerMenu.resetProbe();
  addon.panel.unregister();
  addon.sticky.clear();
  addon.guard.reset();
  // Removes every element and listener the toolkit is tracking.
  addon.toolkit.unregisterAll();
  addon.data.alive = false;
  addon.data.initialized = false;
  delete (globalThis as unknown as { ztoolkit?: unknown }).ztoolkit;
  delete (Zotero as unknown as { AnnotationCompositor?: unknown }).AnnotationCompositor;
  addon = null;
}

/** Re-render when a new main window appears. */
export function onMainWindowLoad(): void {
  addon?.panel.refresh();
}

export function onMainWindowUnload(): void {
  addon?.panel.refresh();
}

/** Exposed for the "expand a stored folder key" path in tests and the console. */
export { keyToPath };

export function getAddon(): Addon | null {
  return addon;
}
