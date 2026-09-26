/**
 * Template-driven export of selected folders to clipboard or file.
 *
 * The rendering is pure (`core/exportModel.ts` + `core/template.ts`); this
 * module only gathers choices and delivers the result. The only file it writes
 * is the path the user picked in the file picker.
 */
import { buildExportContext } from "../core/exportModel.js";
import { renderTemplate, TemplateError } from "../core/template.js";
import { TEMPLATE_PRESETS, findPreset } from "../core/defaultTemplates.js";
import type { TemplatePreset } from "../core/defaultTemplates.js";
import type { FolderPath } from "../core/types.js";
import { confirm, select } from "../adapters/dialogs.js";
import { getCitationKey } from "../adapters/citation.js";
import { getCustomColorLabels } from "../adapters/colorLabels.js";
import type { GroupService } from "./groupService.js";
import { groupPaths } from "../core/path.js";
import {
  getTagPrefix,
  getTemplateId,
  setIncludeSubfolders,
  setIncludeUngrouped,
  setTemplateId,
} from "./prefs.js";

/** The citable bibliography item for `item` — itself, or its regular parent. */
function citableItem(item: Zotero.Item): Zotero.Item {
  if (item.isRegularItem()) {
    return item;
  }
  return item.parentItem ?? item;
}

/** Citation key when Better BibTeX has one, otherwise the display title. */
function exportTitle(item: Zotero.Item): string {
  return getCitationKey(citableItem(item)) ?? item.getDisplayTitle();
}

export class ExportService {
  constructor(private readonly service: GroupService) {}

  /** Render `selectedPaths` and return the text, without any UI. */
  async render(
    item: Zotero.Item,
    selectedPaths: readonly FolderPath[],
    preset: TemplatePreset,
    includeSubfolders: boolean,
    includeUngrouped = false,
  ): Promise<string> {
    const colorLabels = await getCustomColorLabels();
    const context = buildExportContext(this.service.load(item).records, getTagPrefix(), {
      selectedPaths,
      includeSubfolders,
      includeUngrouped,
      title: exportTitle(item),
      colorLabels,
    });
    return renderTemplate(preset.template, context, { partials: preset.partials });
  }

  /**
   * Full interactive export flow. With `all`, every folder (subfolders nested)
   * plus the Ungrouped bucket is exported without asking which to include.
   */
  async run(
    item: Zotero.Item,
    selectedPaths: readonly FolderPath[],
    options: { all?: boolean } = {},
  ): Promise<void> {
    const records = this.service.load(item).records;
    const hasUngrouped = records.some(
      (record) => groupPaths(record.tags, getTagPrefix()).length === 0,
    );
    // An item whose annotations are all still Ungrouped has no folders, which
    // used to stop the export with "No folders to export" even though there
    // was plenty to export.
    if (selectedPaths.length === 0 && !hasUngrouped) {
      ztoolkit.notify("Annotation Compositor", "Nothing to export.", false);
      return;
    }
    const presetIndex = select(
      "Export annotations",
      "Template:",
      TEMPLATE_PRESETS.map((preset) => preset.label),
    );
    if (presetIndex === null) {
      return;
    }
    const preset = TEMPLATE_PRESETS[presetIndex] ?? findPreset(getTemplateId());
    setTemplateId(preset.id);

    // Questions that cannot change the result are not asked: there are no
    // subfolders to include when nothing but Ungrouped is being exported, and
    // Ungrouped is the whole export when there are no folders at all.
    let includeSubfolders = true;
    let includeUngrouped = hasUngrouped;
    if (options.all !== true) {
      if (selectedPaths.length > 0) {
        includeSubfolders = confirm(
          "Export annotations",
          "Include subfolders of the selected folders?",
        );
        setIncludeSubfolders(includeSubfolders);
        if (hasUngrouped) {
          includeUngrouped = confirm(
            "Export annotations",
            "Include ungrouped annotations?",
          );
          setIncludeUngrouped(includeUngrouped);
        }
      }
    }

    let output: string;
    try {
      output = await this.render(
        item,
        selectedPaths,
        preset,
        includeSubfolders,
        includeUngrouped,
      );
    } catch (error) {
      // Anything but a template syntax error is a bug; say what it was instead
      // of a generic line, and leave the stack in the error console.
      if (!(error instanceof TemplateError)) {
        Zotero.logError(error as Error);
      }
      const message =
        error instanceof TemplateError
          ? error.message
          : `The export failed: ${error instanceof Error ? error.message : String(error)}`;
      ztoolkit.notify("Annotation Compositor", message, false);
      return;
    }

    // "File…" listed first so it is the dialog's pre-selected default.
    const destination = select("Export annotations", "Send the result to:", [
      "File…",
      "Clipboard",
    ]);
    if (destination === null) {
      return;
    }
    if (destination === 1) {
      if (preset.id === "html") {
        ztoolkit.copyHTML(output, output);
      } else {
        ztoolkit.copyText(output);
      }
      ztoolkit.notify("Annotation Compositor", "Copied to clipboard.");
      return;
    }

    const suggestion = `${item.getDisplayTitle().replace(/[^\w\- ]+/g, "")}.${preset.extension}`;
    const path = await ztoolkit.pickSaveFile("Export annotations", suggestion, [
      [preset.label, `*.${preset.extension}`],
    ]);
    if (path === false) {
      return;
    }
    // The only write outside the snapshot directory: a user-chosen file.
    await IOUtils.writeUTF8(path, output);
    ztoolkit.notify("Annotation Compositor", `Exported to ${PathUtils.filename(path)}.`);
  }
}
