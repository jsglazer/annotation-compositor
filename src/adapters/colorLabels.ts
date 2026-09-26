/**
 * Optional integration with the "Enhanced Notes" plugin's local color-label
 * endpoint (`/enhanced-notes/color-labels`, served on Zotero's own HTTP
 * server — the same server Better BibTeX registers `/better-bibtex/...` on,
 * default port 23119). Enhanced Notes is a separate, optional plugin: every
 * call here is guarded and falls back to an empty map (never throws) when
 * it isn't installed, hasn't registered the endpoint, or the request fails
 * for any reason.
 *
 * Uses the platform `fetch()` rather than `Zotero.HTTP.request` — the latter
 * refuses to even attempt a request while `Zotero.HTTP.browserIsOffline()` is
 * true (Firefox's "work offline" / no-network-detected state), which is
 * meant to short-circuit calls to real remote hosts but wrongly blocks a
 * same-machine loopback call too.
 */
const ENDPOINT = "http://127.0.0.1:23119/enhanced-notes/color-labels";
const CACHE_TTL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 1_500;

let cache: { labels: Record<string, string>; fetchedAt: number } | null = null;

/**
 * `AbortController` is NOT one of the globals Zotero hands the plugin sandbox
 * (its `wantGlobalProperties` list stops at fetch/URL/TextEncoder and friends),
 * so a bare `new AbortController()` threw a ReferenceError here — outside the
 * try, which failed every export and every double-click copy. Borrow the main
 * window's constructor instead, and go without a timeout if there is none.
 */
function makeAbortController(): AbortController | null {
  const win = Zotero.getMainWindow() as unknown as {
    AbortController?: typeof AbortController;
  } | null;
  const Controller: typeof AbortController | undefined =
    typeof AbortController === "function" ? AbortController : win?.AbortController;
  return typeof Controller === "function" ? new Controller() : null;
}

async function fetchLabels(): Promise<Record<string, string>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = makeAbortController();
    if (controller !== null) {
      timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    }
    const response = await fetch(
      ENDPOINT,
      controller === null ? {} : { signal: controller.signal },
    );
    if (!response.ok) {
      ztoolkit.log("annotation-compositor: color-labels request failed", response.status);
      return {};
    }
    const parsed = (await response.json()) as { colorLabels?: unknown };
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
  } catch (error) {
    // Enhanced Notes isn't installed, hasn't started its server endpoint
    // yet, or the request otherwise failed — never block a copy/export on
    // this, but leave a trace for debug output.
    ztoolkit.log("annotation-compositor: color-labels fetch error", error);
    return {};
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
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
