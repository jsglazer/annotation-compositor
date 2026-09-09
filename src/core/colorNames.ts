/**
 * Zotero's 8 built-in annotation-color hexes, mapped to their canonical
 * display names (matching the l10n strings Zotero itself uses: "general-red",
 * "general-yellow", etc., titlecased here since this plugin's export/copy
 * text isn't localized).
 */
export const ANNOTATION_COLOR_NAMES: Readonly<Record<string, string>> = {
  ffd400: "Yellow",
  ff6666: "Red",
  "5fb236": "Green",
  "2ea8e5": "Blue",
  a28ae5: "Purple",
  e56eee: "Magenta",
  f19837: "Orange",
  aaaaaa: "Gray",
};

/** Normalise a Zotero annotation color (any case, with or without '#') to a bare lowercase hex key. */
export function normalizeColorHex(color: string): string {
  return color.trim().toLowerCase().replace(/^#/, "");
}

/**
 * The label to show for an annotation color: a custom label (from the
 * Enhanced Notes plugin, keyed by canonical name — e.g. "Yellow") when one is
 * set, else the canonical built-in name, else the raw color when it isn't one
 * of Zotero's 8 built-ins.
 */
export function resolveColorLabel(
  color: string,
  customLabels: Readonly<Record<string, string>>,
): string {
  const canonical = ANNOTATION_COLOR_NAMES[normalizeColorHex(color)];
  if (canonical === undefined) {
    return color;
  }
  const custom = customLabels[canonical];
  return custom !== undefined && custom.length > 0 ? custom : canonical;
}
