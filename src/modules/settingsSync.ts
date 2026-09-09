/**
 * Settings sync over Zotero's own synced-settings channel.
 *
 * Zotero does not sync extension preferences, but it does sync a per-library
 * key/value store (`Zotero.SyncedSettings`, the same mechanism behind tag
 * colours). The plugin mirrors its preference branch into one entry there, so
 * the settings follow the Zotero account rather than the machine.
 *
 * Every call is best-effort: the synced-settings API can reject an unknown key
 * server-side, and a sync failure must never take the plugin down with it. On
 * any error the local prefs stay authoritative and the plugin carries on.
 */
import { applySyncedPrefs, collectSyncedPrefs, getSyncSettings } from "./prefs.js";

/** The synced-settings key holding this plugin's payload. */
export const SYNC_KEY = "annotationCompositor";

/** Payload schema version, so a future format change can be detected. */
const PAYLOAD_VERSION = 1;

interface SyncPayload {
  readonly version: number;
  /** Millisecond timestamp of the push that produced this payload. */
  readonly updated: number;
  readonly prefs: Readonly<Record<string, unknown>>;
}

type SyncedSettingsApi = {
  get(libraryID: number, setting: string): unknown;
  set(libraryID: number, setting: string, value: unknown): Promise<unknown>;
};

function api(): SyncedSettingsApi | null {
  const candidate = (Zotero as unknown as { SyncedSettings?: SyncedSettingsApi })
    .SyncedSettings;
  return typeof candidate?.get === "function" && typeof candidate.set === "function"
    ? candidate
    : null;
}

function libraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

function isPayload(value: unknown): value is SyncPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SyncPayload>;
  return (
    candidate.version === PAYLOAD_VERSION &&
    typeof candidate.updated === "number" &&
    typeof candidate.prefs === "object" &&
    candidate.prefs !== null
  );
}

/**
 * Settings-sync driver: pulls once at startup, then pushes (debounced) whenever
 * a synced pref changes. Owns no state beyond the debounce timer and the
 * timestamp of the payload it last saw, so it can be created and dropped freely.
 */
export class SettingsSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSeen = 0;

  constructor(private readonly debounceMs: number = 2000) {}

  /**
   * Adopt the remote settings if there are any. Returns the number of prefs
   * changed locally; 0 covers "nothing to do", "sync disabled" and "failed".
   */
  pull(): number {
    if (!getSyncSettings()) {
      return 0;
    }
    const settings = api();
    if (settings === null) {
      return 0;
    }
    try {
      const raw = settings.get(libraryID(), SYNC_KEY);
      // Never re-apply a payload this session already produced or adopted —
      // that would undo edits made locally since.
      if (!isPayload(raw) || raw.updated <= this.lastSeen) {
        return 0;
      }
      this.lastSeen = raw.updated;
      return applySyncedPrefs(raw.prefs);
    } catch {
      return 0;
    }
  }

  /** Write the local settings up. Silently does nothing when sync is off. */
  async push(): Promise<boolean> {
    if (!getSyncSettings()) {
      return false;
    }
    const settings = api();
    if (settings === null) {
      return false;
    }
    const payload: SyncPayload = {
      version: PAYLOAD_VERSION,
      updated: Date.now(),
      prefs: collectSyncedPrefs(),
    };
    try {
      await settings.set(libraryID(), SYNC_KEY, payload);
      this.lastSeen = payload.updated;
      return true;
    } catch {
      // An unknown synced-settings key can be refused server-side; local prefs
      // remain correct, so this is a no-op rather than an error the user sees.
      return false;
    }
  }

  /** Coalesce a burst of preference edits into a single push. */
  schedulePush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.push();
    }, this.debounceMs);
  }

  /** Flush any pending push and stop the timer. */
  unregister(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      void this.push();
    }
    this.lastSeen = 0;
  }
}
