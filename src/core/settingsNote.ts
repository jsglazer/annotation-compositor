/**
 * The settings-sync payload as it is stored in a Zotero note.
 *
 * Zotero's synced-settings channel only accepts the server's own keys, so the
 * plugin carries its settings in an ordinary standalone note instead — notes
 * sync like any other item. The note body is HTML; the payload sits as escaped
 * JSON inside its one `<pre>` block, which survives the note editor re-saving
 * the note with its own wrapper markup.
 */

/** Payload schema version, so a future format change can be detected. */
export const PAYLOAD_VERSION = 1;

/** Heading shown as the note's title in the items list. */
export const SETTINGS_NOTE_TITLE = "Annotation Compositor settings";

export interface SyncPayload {
  readonly version: number;
  /** Millisecond timestamp of the push that produced this payload. */
  readonly updated: number;
  readonly prefs: Readonly<Record<string, unknown>>;
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeHTML(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function isPayload(value: unknown): value is SyncPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SyncPayload>;
  return (
    candidate.version === PAYLOAD_VERSION &&
    typeof candidate.updated === "number" &&
    typeof candidate.prefs === "object" &&
    candidate.prefs !== null &&
    !Array.isArray(candidate.prefs)
  );
}

/** The note HTML for a payload. */
export function encodeSettingsNote(payload: SyncPayload): string {
  return [
    `<h1>${SETTINGS_NOTE_TITLE}</h1>`,
    "<p>Managed by the Annotation Compositor plugin to sync its settings between your devices. Do not edit or delete this note; to stop syncing, untick the option in the plugin's preferences.</p>",
    `<pre>${escapeHTML(JSON.stringify(payload, null, 2))}</pre>`,
  ].join("\n");
}

/** The payload inside a settings note, or null if the note holds none. */
export function decodeSettingsNote(html: string): SyncPayload | null {
  const match = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  if (match === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(unescapeHTML(match[1] ?? ""));
    return isPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether two pref maps hold the same values, ignoring key order. */
export function samePrefs(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key])
  );
}
