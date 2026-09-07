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
import type { GroupService } from "./groupService.js";
import {
  getIncludeSubfolders,
  getTagPrefix,
  getTemplateId,
  setIncludeSubfolders,
  setTemplateId,
} from "./prefs.js";

export class ExportService {
  constructor(private readonly service: GroupService) {}

  /** Render `selectedPaths` and return the text, without any UI. */
  render(
    item: Zotero.Item,
    selectedPaths: readonly FolderPath[],
    preset: TemplatePreset,
    includeSubfolders: boolean,
    includeUngrouped = false,
  ): string {
    const context = buildExportContext(this.service.load(item).records, getTagPrefix(), {
      selectedPaths,
      includeSubfolders,
      includeUngrouped,
      title: item.getDisplayTitle(),
    });
    return renderTemplate(preset.template, context, { partials: preset.partials });
  }

  /** Full interactive export flow. */
  async run(item: Zotero.Item, selectedPaths: readonly FolderPath[]): Promise<void> {
    if (selectedPaths.length === 0) {
      ztoolkit.notify("Annotation Compositor", "No folders to export.", false);
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

    const includeSubfolders = confirm(
      "Export annotations",
      "Include subfolders of the selected folders?",
    );
    setIncludeSubfolders(includeSubfolders);
    void getIncludeSubfolders();

    let output: string;
    try {
      output = this.render(item, selectedPaths, preset, includeSubfolders);
    } catch (error) {
      const message =
        error instanceof TemplateError
          ? error.message
          : "The template could not be rendered.";
      ztoolkit.notify("Annotation Compositor", message, false);
      return;
    }

    const destination = select("Export annotations", "Send the result to:", [
      "Clipboard",
      "File…",
    ]);
    if (destination === null) {
      return;
    }
    if (destination === 0) {
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
