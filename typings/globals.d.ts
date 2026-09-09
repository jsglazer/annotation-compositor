/**
 * Ambient declarations for the parts of the Zotero 7 plugin sandbox that
 * `zotero-types` does not cover. Nothing here is imported by `src/core/`.
 */

/** Injected by `bootstrap.js` at startup. */
declare const rootURI: string;

declare const ztoolkit: import("../src/adapters/toolkit.js").CompositorToolkit;

// Gecko globals available in the plugin sandbox (Zotero 7+ / Firefox 115 ESR).
declare const IOUtils: {
  makeDirectory(
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ): Promise<void>;
  writeUTF8(
    path: string,
    data: string,
    options?: { mode?: string; tmpPath?: string },
  ): Promise<number>;
  readUTF8(path: string): Promise<string>;
  remove(
    path: string,
    options?: { ignoreAbsent?: boolean; recursive?: boolean },
  ): Promise<void>;
  getChildren(path: string, options?: { ignoreAbsent?: boolean }): Promise<string[]>;
  exists(path: string): Promise<boolean>;
};

declare const PathUtils: {
  join(...parts: string[]): string;
  filename(path: string): string;
  parent(path: string): string | null;
};

declare namespace Zotero {
  const AnnotationCompositor: typeof import("../src/index.js").default;
}
