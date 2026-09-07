/**
 * The ONLY module that imports `zotero-plugin-toolkit`.
 *
 * Core and feature modules import the thin wrappers re-exported here, so a
 * toolkit incompatibility on Zotero 8/9 is a one-file fix.
 */
import {
  BasicTool,
  ClipboardHelper,
  DialogHelper,
  FilePickerHelper,
  ProgressWindowHelper,
  UITool,
  unregister,
} from "zotero-plugin-toolkit";
import type { ElementProps } from "zotero-plugin-toolkit";

export type CompositorElementProps = ElementProps;

/** Thin facade over the toolkit surface this plugin actually uses. */
export class CompositorToolkit {
  private readonly basic = new BasicTool();
  private readonly ui = new UITool(this.basic);

  /** Plugin-scoped logging; silent unless Zotero debug output is enabled. */
  log(...data: unknown[]): void {
    this.basic.log(...data);
  }

  /** Fetch a sandbox global (`window`, `document`, `ZoteroPane`, …). */
  getGlobal<K extends keyof typeof globalThis>(name: K): (typeof globalThis)[K] {
    return this.basic.getGlobal(name as never) as (typeof globalThis)[K];
  }

  /** Zotero's main window, or `null` when none is open yet. */
  getMainWindow(): Window | null {
    return (Zotero.getMainWindow() as Window | null) ?? null;
  }

  /**
   * Tracked element creation. Everything made this way is removed again by
   * {@link unregisterAll} on shutdown, which is how the plugin cleans itself
   * out of the sandbox on disable/uninstall.
   */
  createElement<T extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tagName: T,
    props?: CompositorElementProps,
  ): HTMLElementTagNameMap[T] {
    return this.ui.createElement(doc, tagName, props) as HTMLElementTagNameMap[T];
  }

  /** Copy text to the clipboard. */
  copyText(text: string): void {
    new ClipboardHelper().addText(text, "text/unicode").copy();
  }

  /** Copy rich text (HTML) with a plain-text fallback. */
  copyHTML(html: string, plain: string): void {
    new ClipboardHelper()
      .addText(plain, "text/unicode")
      .addText(html, "text/html")
      .copy();
  }

  /** Ask the user where to save an export. Returns `false` when cancelled. */
  async pickSaveFile(
    title: string,
    suggestion: string,
    filters: [string, string][],
  ): Promise<string | false> {
    const result = await new FilePickerHelper(title, "save", filters, suggestion).open();
    return typeof result === "string" ? result : false;
  }

  /** Ask the user for a file to import. Returns `false` when cancelled. */
  async pickOpenFile(
    title: string,
    filters: [string, string][],
  ): Promise<string | false> {
    const result = await new FilePickerHelper(title, "open", filters).open();
    return typeof result === "string" ? result : false;
  }

  /** Transient progress/notification popup. */
  notify(header: string, body: string, success = true): void {
    new ProgressWindowHelper(header, { closeOtherProgressWindows: true })
      .createLine({ text: body, type: success ? "success" : "fail" })
      .show(3000);
  }

  /** A toolkit dialog builder, for the export and restore dialogs. */
  dialog(rows: number, columns: number): DialogHelper {
    return new DialogHelper(rows, columns);
  }

  /** Remove every element, listener and helper the toolkit is tracking. */
  unregisterAll(): void {
    unregister(this.basic);
  }
}

export type { DialogHelper };
