/**
 * Typed preference access. One module owns the pref keys and their defaults;
 * nothing else reads `Zotero.Prefs` directly.
 */
import { normalizePrefix } from "../core/path.js";
import { TAG_TYPE_AUTOMATIC, TAG_TYPE_MANUAL } from "../core/types.js";
import type { ColorRule, FolderPath, TagType } from "../core/types.js";

const BRANCH = "extensions.zotero.annotationcompositor";

export const PREF_KEYS = {
  tagPrefix: `${BRANCH}.tagPrefix`,
  tagType: `${BRANCH}.tagType`,
  navigateOnClick: `${BRANCH}.navigateOnClick`,
  persistStickyGroup: `${BRANCH}.persistStickyGroup`,
  stickyGroups: `${BRANCH}.stickyGroups`,
  libraryColorRules: `${BRANCH}.libraryColorRules`,
  itemColorRules: `${BRANCH}.itemColorRules`,
  templateId: `${BRANCH}.templateId`,
  includeSubfolders: `${BRANCH}.includeSubfolders`,
  includeUngrouped: `${BRANCH}.includeUngrouped`,
  warningAcknowledged: `${BRANCH}.warningAcknowledged`,
  useCustomSelectionColor: `${BRANCH}.useCustomSelectionColor`,
  selectionColor: `${BRANCH}.selectionColor`,
} as const;

export const DEFAULT_TAG_PREFIX = "grp";
export const DEFAULT_SELECTION_COLOR = "#2ea8e5";

function readString(key: string, fallback: string): string {
  const value = Zotero.Prefs.get(key, true);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const value = Zotero.Prefs.get(key, true);
  return typeof value === "boolean" ? value : fallback;
}

function readJSON<T>(key: string, fallback: T): T {
  const raw = Zotero.Prefs.get(key, true);
  if (typeof raw !== "string" || raw.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The configured tag prefix, normalised. Never changed silently. */
export function getTagPrefix(): string {
  const result = normalizePrefix(readString(PREF_KEYS.tagPrefix, DEFAULT_TAG_PREFIX));
  return result.ok && result.value !== undefined ? result.value : DEFAULT_TAG_PREFIX;
}

export function setTagPrefix(prefix: string): void {
  Zotero.Prefs.set(PREF_KEYS.tagPrefix, prefix, true);
}

/** Group tags are MANUAL (type 0) by default; the pref can switch the library. */
export function getTagType(): TagType {
  const value = Zotero.Prefs.get(PREF_KEYS.tagType, true);
  return value === 1 || value === "1" ? TAG_TYPE_AUTOMATIC : TAG_TYPE_MANUAL;
}

export function setTagType(tagType: TagType): void {
  Zotero.Prefs.set(PREF_KEYS.tagType, tagType, true);
}

export function getNavigateOnClick(): boolean {
  return readBool(PREF_KEYS.navigateOnClick, true);
}

export function getPersistStickyGroup(): boolean {
  return readBool(PREF_KEYS.persistStickyGroup, false);
}

export function getLibraryColorRules(): ColorRule[] {
  return readJSON<ColorRule[]>(PREF_KEYS.libraryColorRules, []);
}

export function setLibraryColorRules(rules: readonly ColorRule[]): void {
  Zotero.Prefs.set(PREF_KEYS.libraryColorRules, JSON.stringify(rules), true);
}

/** Per-item colour rules, keyed by item key. */
export function getItemColorRules(itemKey: string): ColorRule[] {
  return (
    readJSON<Record<string, ColorRule[]>>(PREF_KEYS.itemColorRules, {})[itemKey] ?? []
  );
}

export function setItemColorRules(itemKey: string, rules: readonly ColorRule[]): void {
  const all = readJSON<Record<string, ColorRule[]>>(PREF_KEYS.itemColorRules, {});
  if (rules.length === 0) {
    delete all[itemKey];
  } else {
    all[itemKey] = [...rules];
  }
  Zotero.Prefs.set(PREF_KEYS.itemColorRules, JSON.stringify(all), true);
}

/** Sticky group per reader tab, persisted only when the pref says so. */
export function getPersistedStickyGroups(): Record<string, FolderPath> {
  return getPersistStickyGroup()
    ? readJSON<Record<string, FolderPath>>(PREF_KEYS.stickyGroups, {})
    : {};
}

export function setPersistedStickyGroups(groups: Record<string, FolderPath>): void {
  if (getPersistStickyGroup()) {
    Zotero.Prefs.set(PREF_KEYS.stickyGroups, JSON.stringify(groups), true);
  }
}

export function getTemplateId(): string {
  return readString(PREF_KEYS.templateId, "markdown");
}

export function setTemplateId(id: string): void {
  Zotero.Prefs.set(PREF_KEYS.templateId, id, true);
}

export function getIncludeSubfolders(): boolean {
  return readBool(PREF_KEYS.includeSubfolders, true);
}

export function setIncludeSubfolders(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.includeSubfolders, value, true);
}

export function getIncludeUngrouped(): boolean {
  return readBool(PREF_KEYS.includeUngrouped, true);
}

export function setIncludeUngrouped(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.includeUngrouped, value, true);
}

export function getUseCustomSelectionColor(): boolean {
  return readBool(PREF_KEYS.useCustomSelectionColor, false);
}

export function setUseCustomSelectionColor(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.useCustomSelectionColor, value, true);
}

/** Custom background colour for a selected row in the panel. */
export function getSelectionColor(): string {
  return readString(PREF_KEYS.selectionColor, DEFAULT_SELECTION_COLOR);
}

export function setSelectionColor(color: string): void {
  Zotero.Prefs.set(PREF_KEYS.selectionColor, color, true);
}

/** First-run warning about "Delete Automatic Tags in This Library". */
export function getWarningAcknowledged(): boolean {
  return readBool(PREF_KEYS.warningAcknowledged, false);
}

export function setWarningAcknowledged(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.warningAcknowledged, value, true);
}
