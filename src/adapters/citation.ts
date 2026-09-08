/**
 * Better BibTeX citation-key lookup.
 *
 * Better BibTeX is an optional third-party plugin, so every call is guarded
 * and falls back to `null` (never throws) when it isn't installed or has no
 * key for the item.
 */
interface BetterBibTeXKeyManager {
  get?: (itemID: number) => { citekey?: string; citationKey?: string } | undefined;
}

/** The Better BibTeX citation key for `item`, or `null` if unavailable. */
export function getCitationKey(item: Zotero.Item): string | null {
  const bbt = (
    Zotero as unknown as { BetterBibTeX?: { KeyManager?: BetterBibTeXKeyManager } }
  ).BetterBibTeX;
  try {
    const record = bbt?.KeyManager?.get?.(item.id);
    const key = record?.citekey ?? record?.citationKey;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
