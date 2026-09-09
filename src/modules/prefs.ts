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
  stickyOnCreate: `${BRANCH}.stickyOnCreate`,
  syncSettings: `${BRANCH}.syncSettings`,
  pinGroupsPanel: `${BRANCH}.pinGroupsPanel`,
} as const;

/**
 * The prefs that travel between machines via Zotero's synced settings.
 *
 * Deliberately excluded: `stickyGroups` (keyed by reader tab id, meaningless on
 * another machine) and `warningAcknowledged` (a per-install first-run notice).
 */
export const SYNCED_PREF_KEYS = [
  PREF_KEYS.tagPrefix,
  PREF_KEYS.tagType,
  PREF_KEYS.navigateOnClick,
  PREF_KEYS.persistStickyGroup,
  PREF_KEYS.libraryColorRules,
  PREF_KEYS.itemColorRules,
  PREF_KEYS.templateId,
  PREF_KEYS.includeSubfolders,
  PREF_KEYS.includeUngrouped,
  PREF_KEYS.useCustomSelectionColor,
  PREF_KEYS.selectionColor,
  PREF_KEYS.stickyOnCreate,
  PREF_KEYS.pinGroupsPanel,
] as const;

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

/** Group tags are AUTOMATIC (type 1) by default; the pref can switch the library. */
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

/** Whether the "new folder" dialog pre-ticks "pin as this tab's sticky folder". */
export function getStickyOnCreate(): boolean {
  return readBool(PREF_KEYS.stickyOnCreate, false);
}

export function setStickyOnCreate(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.stickyOnCreate, value, true);
}

/**
 * Whether this plugin pins its Groups panel as Zotero's default item-pane
 * view (via Zotero's own global `pinnedPane` pref) on every startup,
 * overriding whatever the user pinned themselves in the meantime.
 */
export function getPinGroupsPanel(): boolean {
  return readBool(PREF_KEYS.pinGroupsPanel, true);
}

export function setPinGroupsPanel(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.pinGroupsPanel, value, true);
}

/** Whether settings are mirrored into Zotero's synced settings. */
export function getSyncSettings(): boolean {
  return readBool(PREF_KEYS.syncSettings, true);
}

export function setSyncSettings(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.syncSettings, value, true);
}

/** Every syncable pref and its current value, for the settings-sync payload. */
export function collectSyncedPrefs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_PREF_KEYS) {
    const value = Zotero.Prefs.get(key, true);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Write a settings-sync payload back into the local pref branch. */
export function applySyncedPrefs(values: Readonly<Record<string, unknown>>): number {
  let applied = 0;
  const allowed = new Set<string>(SYNCED_PREF_KEYS);
  for (const [key, value] of Object.entries(values)) {
    // Only keys this version knows about, and only primitives — a hostile or
    // stale payload must never be able to set an arbitrary Zotero pref.
    if (!allowed.has(key)) {
      continue;
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    if (Zotero.Prefs.get(key, true) !== value) {
      Zotero.Prefs.set(key, value as string | number | boolean, true);
      applied += 1;
    }
  }
  return applied;
}

/** First-run warning about "Delete Automatic Tags in This Library". */
export function getWarningAcknowledged(): boolean {
  return readBool(PREF_KEYS.warningAcknowledged, false);
}

export function setWarningAcknowledged(value: boolean): void {
  Zotero.Prefs.set(PREF_KEYS.warningAcknowledged, value, true);
}
