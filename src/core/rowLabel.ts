/** Longest annotation text shown in a panel row before it is cut with "…". */
export const ROW_TEXT_MAX = 50;

/**
 * Cut `text` to its first `max` characters followed by "…"; text of `max`
 * characters or fewer is returned unchanged. Counts code points, so an emoji
 * or other astral character is never split in half. Exports never use this —
 * they always carry the full text.
 */
export function truncateRowText(text: string, max: number = ROW_TEXT_MAX): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("").trimEnd()}…`;
}

/** A page label as shown in a panel row: "(367)", or "" when there is none. */
export function formatRowPage(pageLabel: string): string {
  return pageLabel.length > 0 ? `(${pageLabel})` : "";
}
