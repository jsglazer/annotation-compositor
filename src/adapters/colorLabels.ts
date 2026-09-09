/**
 * Optional integration with the "Enhanced Notes" plugin's local color-label
 * endpoint (`/enhanced-notes/color-labels`, served on Zotero's own HTTP
 * server — the same server Better BibTeX registers `/better-bibtex/...` on,
 * default port 23119). Enhanced Notes is a separate, optional plugin: every
 * call here is guarded and falls back to an empty map (never throws) when
 * it isn't installed, hasn't registered the endpoint, or the request fails
 * for any reason.
 */
const ENDPOINT = "http://127.0.0.1:23119/enhanced-notes/color-labels";
const CACHE_TTL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 1_500;

let cache: { labels: Record<string, string>; fetchedAt: number } | null = null;

async function fetchLabels(): Promise<Record<string, string>> {
  try {
    const response = await Zotero.HTTP.request("GET", ENDPOINT, {
      timeout: REQUEST_TIMEOUT_MS,
      successCodes: [200],
    });
    const parsed = JSON.parse(response.responseText) as { colorLabels?: unknown };
    const raw = parsed.colorLabels;
    if (raw === null || typeof raw !== "object") {
      return {};
    }
    const labels: Record<string, string> = {};
    for (const [name, label] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof label === "string" && label.length > 0) {
        labels[name] = label;
      }
    }
    return labels;
  } catch {
    return {};
  }
}

/**
 * Custom per-color labels from Enhanced Notes, keyed by canonical color name
 * (e.g. `{ Yellow: "Key" }`). Briefly cached so a burst of copies/exports
 * doesn't fire a request per annotation.
 */
export async function getCustomColorLabels(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache !== null && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.labels;
  }
  const labels = await fetchLabels();
  cache = { labels, fetchedAt: now };
  return labels;
}
