# Annotation Compositor

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/annotation-compositor?logo=github)](https://github.com/jsglazer/annotation-compositor/releases) [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/annotation-compositor/blob/main/LICENSE) [![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai) [![Gemini Flash Antigravity](https://img.shields.io/badge/Gemini%20Flash-Antigravity-4f86f7?logo=google-gemini&logoColor=white)](https://github.com/google-gemini)

A Zotero plugin that adds a folder/subfolder organisation layer over the annotations of a single item. Zotero's annotation sidebar is a flat list; once a PDF carries a few hundred highlights, that list stops being usable. Annotation Compositor gives those annotations a tree — with multi-membership, colour-driven auto-assignment, a per-tab sticky group, and templated export — without a sidecar database and without touching the PDF.

## How it works

Group membership is stored as ordinary Zotero tags under a configurable prefix (`grp/Methods/Sampling`). That choice does a lot of work:

- **Many-to-many for free.** One annotation can live in as many folders as you like.
- **Sync-native.** Group tags travel through ordinary Zotero sync; there is no separate store to keep in step.
- **Never out of date.** The tree is parsed from the tags at render time, so it cannot drift away from the annotations it describes.

Group tags are **manual (type 0)** tags by default, so Zotero's _Delete Automatic Tags in This Library_ command cannot wipe your hierarchy. A preference switches the library to automatic (type 1) tags if you would rather keep them out of the tag selector; switching performs a snapshot-backed rewrite of every existing group tag rather than leaving the two types mixed.

## Features

- **Groups panel** in the item pane — nested folder tree with member counts and colour swatches, a permanent derived _Ungrouped_ bucket, filter box, and expand/collapse all
- **Multi-folder membership** — an annotation belongs to every folder you put it in
- **Drag and drop** — dragging an annotation onto a folder **moves** it (adds the destination, removes the source, in one transaction); **⌘-drag** (Alt elsewhere) **adds** without removing. Dragging a folder reparents that folder and its whole subtree
- **Folder operations** — create, rename, delete and reparent, executed as transactional tag-path rewrites across every affected annotation, each preceded by a snapshot
- **Multi-select** — shift-click selects a contiguous range of annotations; ctrl/cmd-click toggles one, for drag, folder-menu, and drop-target operations that act on the whole selection
- **Click to navigate** — clicking an annotation row opens the reader (if it isn't already open, or brings its tab to the front if it is) and scrolls to it (toggleable); double-click copies the annotation's text and comment to the clipboard
- **Selection sync** — clicking a highlight in the reader text or in Zotero's own native annotations sidebar selects and scrolls to the matching row in the Groups panel, in both directions
- **Reader context menu** — "Add to group ▸" on right-click, nested when the reader supports submenus and flat `A > B > C` labels when it does not. Above 25 folders the menu collapses to a recents list plus a modal picker
- **Panel context menu** — right-click an annotation for "Add to folder", or a folder for Rename/New subfolder/Delete/Pin sticky group/Clear sticky group, in a popup menu at the cursor
- **Colour rules** — map an annotation colour to one or more folders, library-wide with optional per-item overrides. Rules fire at creation time only and are purely additive
- **Sticky group** — pin a folder to a reader tab so new annotations join it automatically; optionally persisted across sessions
- **Templated export** — Mustache-subset templates (`{{var}}`, `{{#section}}`, `{{^inverted}}`, self-referencing partials for subfolder traversal) with Markdown and HTML defaults, include-subfolders and include-ungrouped toggles, ordering by `annotationSortIndex`, to clipboard or file. The document title uses the item's Better BibTeX citation key when one is available, falling back to its display title
- **Snapshots** — a rolling JSON snapshot is written before every group-tag write, to `<Zotero data directory>/annotation-compositor/snapshots/`. **Restore previous grouping** shows a diff preview before it writes, and is the undo path

## Installation

**Requires Zotero 7 or later** (`strict_min_version` 7.0, `strict_max_version` 9.0.*).

1. Download `annotation-compositor.xpi` from the [releases page](https://github.com/jsglazer/annotation-compositor/releases)
2. In Zotero: **Tools → Plugins → gear icon → Install Plugin From File**
3. Select the downloaded `.xpi` and restart Zotero

## Folder names

The path separator `/` is reserved, so a folder name may not contain it. Names are trimmed, case-sensitive, may not be empty, and folders nest at most four levels below the prefix. There is no escaping scheme — tags stay readable in Zotero's own tag UI.

## Preferences

| Preference                                              | Default                      | What it does                                                                          |
| ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `tagPrefix`                                             | `grp`                        | Namespace for group tags. Changing it runs a confirm-gated, snapshot-backed migration |
| `tagType`                                               | `0` (manual)                 | Manual or automatic tags for group membership                                         |
| `navigateOnClick`                                       | `true`                       | Clicking an annotation row scrolls the reader to it                                   |
| `persistStickyGroup`                                    | `false`                      | Remember sticky groups across sessions                                                |
| `useCustomSelectionColor` / `selectionColor`            | `false` / `#2ea8e5`          | Override the selected-row background with a custom highlight color                    |
| `templateId` / `includeSubfolders` / `includeUngrouped` | `markdown` / `true` / `true` | Export defaults                                                                       |

## Development

```bash
npm install
npm test          # Vitest: the pure core, headless
npm run typecheck # tsc --noEmit
npm run build     # type-check, bundle, and pack the .xpi into build/
npm start         # run against a development Zotero profile
```

The codebase is split so that the interesting logic is testable without launching Zotero:

- `src/core/` — pure modules with **zero** Zotero or DOM references: tag-path grammar, tree derivation, the rewrite/diff engine, colour rules, the template engine, the export model, snapshot serialisation, the context-menu model, and the notifier loop guard. Everything here takes plain objects and returns plain objects
- `src/adapters/` — the only files that touch Zotero: the toolkit facade, annotation reading, the transactional tag writer, the snapshot path provider, reader navigation, prompts, and the reader context menu
- `src/modules/` — feature glue: the item-pane panel, notifier subscription, snapshot store, export/restore flows, preferences
- `test/` — Vitest suites covering the core modules

Two invariants hold everywhere by construction: every multi-annotation tag write goes through one `Zotero.DB.executeTransaction` in `src/adapters/tagWriter.ts`, and every write is preceded by a snapshot taken in `src/modules/groupService.ts`.

## Reference projects

- [`zotero/make-it-red`](https://github.com/zotero/make-it-red) — official bootstrap structure
- [`windingwind/zotero-plugin-template`](https://github.com/windingwind/zotero-plugin-template) — build tooling
- [`windingwind/zotero-plugin-toolkit`](https://github.com/windingwind/zotero-plugin-toolkit) — item pane, menu and notifier helpers
- [`windingwind/zotero-actions-tags`](https://github.com/windingwind/zotero-actions-tags) — prior art for tag-driven annotation workflows

## License

MIT — see [LICENSE](LICENSE).
