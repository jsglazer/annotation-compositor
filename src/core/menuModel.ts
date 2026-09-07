/**
 * Reader context-menu shape. Pure: no globals, no DOM — the adapter turns this
 * plain model into whatever the reader's `append` API accepts.
 *
 * Shape is decided once per session by a capability probe: nested submenus when
 * the reader supports them, otherwise flat `A > B > C` labels. Above
 * {@link MENU_COLLAPSE_THRESHOLD} folders the menu collapses to a short recents
 * list plus a `More…` entry that opens the modal folder picker.
 */
import { comparePaths, pathKey } from "./path.js";
import type { FolderPath } from "./types.js";

export const MENU_COLLAPSE_THRESHOLD = 25;
export const MENU_RECENTS_LIMIT = 8;
export const FLAT_SEPARATOR = " > ";

export type MenuEntry =
  | { readonly kind: "folder"; readonly label: string; readonly path: FolderPath }
  | {
      readonly kind: "submenu";
      readonly label: string;
      readonly path: FolderPath;
      /** Assigns to this folder itself; present so a parent is selectable. */
      readonly selfEntry: MenuEntry;
      readonly children: readonly MenuEntry[];
    }
  | { readonly kind: "more"; readonly label: string }
  | { readonly kind: "new"; readonly label: string };

export interface MenuModel {
  readonly shape: "nested" | "flat" | "collapsed";
  readonly entries: readonly MenuEntry[];
}

export interface MenuOptions {
  /** False when the capability probe found no nested-submenu support. */
  readonly nestedSupported: boolean;
  /** Recently used folder keys, most recent first. */
  readonly recentKeys?: readonly string[];
  readonly collapseThreshold?: number;
  readonly recentsLimit?: number;
  readonly labels?: {
    readonly more?: string;
    readonly newFolder?: string;
    readonly thisFolder?: string;
  };
}

function flatLabel(path: FolderPath): string {
  return path.join(FLAT_SEPARATOR);
}

function nestedEntries(
  paths: readonly FolderPath[],
  depth: number,
  parent: FolderPath,
  thisFolderLabel: string,
): MenuEntry[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path.length <= depth) {
      continue;
    }
    let matches = true;
    for (let i = 0; i < depth; i += 1) {
      if (path[i] !== parent[i]) {
        matches = false;
        break;
      }
    }
    if (!matches || seen.has(path[depth])) {
      continue;
    }
    seen.add(path[depth]);
    names.push(path[depth]);
  }
  names.sort();

  return names.map((name) => {
    const path = [...parent, name];
    const children = nestedEntries(paths, depth + 1, path, thisFolderLabel);
    if (children.length === 0) {
      return { kind: "folder", label: name, path } as MenuEntry;
    }
    return {
      kind: "submenu",
      label: name,
      path,
      selfEntry: { kind: "folder", label: thisFolderLabel, path },
      children,
    } as MenuEntry;
  });
}

/** Build the menu model for the folders currently on an item. */
export function buildMenuModel(
  paths: readonly FolderPath[],
  options: MenuOptions,
): MenuModel {
  const unique = new Map<string, FolderPath>();
  for (const path of paths) {
    if (path.length > 0) {
      unique.set(pathKey(path), path);
    }
  }
  const all = [...unique.values()].sort(comparePaths);
  const moreLabel = options.labels?.more ?? "More…";
  const newLabel = options.labels?.newFolder ?? "New folder…";
  const thisFolderLabel = options.labels?.thisFolder ?? "This folder";
  const threshold = options.collapseThreshold ?? MENU_COLLAPSE_THRESHOLD;
  const recentsLimit = options.recentsLimit ?? MENU_RECENTS_LIMIT;

  if (all.length > threshold) {
    const byKey = new Map(all.map((path) => [pathKey(path), path]));
    const recents: MenuEntry[] = [];
    for (const key of options.recentKeys ?? []) {
      const path = byKey.get(key);
      if (path !== undefined && recents.length < recentsLimit) {
        recents.push({ kind: "folder", label: flatLabel(path), path });
      }
    }
    return {
      shape: "collapsed",
      entries: [
        ...recents,
        { kind: "more", label: moreLabel },
        { kind: "new", label: newLabel },
      ],
    };
  }

  if (!options.nestedSupported) {
    return {
      shape: "flat",
      entries: [
        ...all.map((path): MenuEntry => ({
          kind: "folder",
          label: flatLabel(path),
          path,
        })),
        { kind: "new", label: newLabel },
      ],
    };
  }

  return {
    shape: "nested",
    entries: [
      ...nestedEntries(all, 0, [], thisFolderLabel),
      { kind: "new", label: newLabel },
    ],
  };
}

/** Flatten a menu model into leaf assignment entries, for the flat fallback. */
export function flattenEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "submenu") {
      out.push({ kind: "folder", label: flatLabel(entry.path), path: entry.path });
      out.push(...flattenEntries(entry.children));
    } else if (entry.kind === "folder") {
      // Relabel with the full path: without the submenu around it, a leaf's
      // own name is ambiguous.
      out.push({ kind: "folder", label: flatLabel(entry.path), path: entry.path });
    } else {
      out.push(entry);
    }
  }
  return out;
}
