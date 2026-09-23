/**
 * Settings sync through a Zotero note.
 *
 * Zotero does not sync extension preferences, and its synced-settings store
 * (`Zotero.SyncedSettings`) is no way round that: the server accepts only its
 * own keys and answers any other with HTTP 400, which fails the user's whole
 * sync. So the plugin mirrors its preference branch into one tagged standalone
 * note in My Library instead — notes sync like any other item, so the settings
 * follow the Zotero account rather than the machine.
 *
 * Every call is best-effort: a sync failure must never take the plugin down
 * with it. On any error the local prefs stay authoritative and the plugin
 * carries on.
 */
import {
  PAYLOAD_VERSION,
  decodeSettingsNote,
  encodeSettingsNote,
  samePrefs,
} from "../core/settingsNote.js";
import type { SyncPayload } from "../core/settingsNote.js";
import { applySyncedPrefs, collectSyncedPrefs, getSyncSettings } from "./prefs.js";

/**
 * The synced-settings key used by 1.0.8 and earlier. The server rejects it, so
 * a leftover local row blocks every sync until it is deleted.
 */
export const LEGACY_SYNC_KEY = "annotationCompositor";

/** Manual tag marking the settings note, so it can be found again. */
export const SETTINGS_NOTE_TAG = "_annotation-compositor-settings";

/**
 * How long after startup to seed the note when none exists yet, so Zotero's
 * own startup sync has a chance to bring down another device's note first.
 */
const SEED_DELAY_MS = 60_000;
const SEED_RETRY_MS = 30_000;
/** Coalesce the notifier burst of a synced note into one pull. */
const PULL_DEBOUNCE_MS = 500;

interface SettingsNote {
  readonly item: Zotero.Item;
  /** Null when the note's body no longer holds a readable payload. */
  readonly payload: SyncPayload | null;
}

type LegacySettingsApi = {
  get(libraryID: number, setting: string): unknown;
  clear(
    libraryID: number,
    setting: string,
    options?: { skipDeleteLog?: boolean },
  ): Promise<unknown>;
};

function libraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

/**
 * Delete the rejected synced-settings row left by 1.0.8 and earlier, so
 * Zotero stops trying to upload it. `skipDeleteLog`: the key never reached the
 * server, so there is no remote copy to delete — and a delete of an invalid
 * key would be refused too.
 */
export async function removeLegacySetting(): Promise<boolean> {
  const api = (Zotero as unknown as { SyncedSettings?: LegacySettingsApi })
    .SyncedSettings;
  if (typeof api?.get !== "function" || typeof api.clear !== "function") {
    return false;
  }
  try {
    const value = api.get(libraryID(), LEGACY_SYNC_KEY);
    if (value === null || value === undefined) {
      return false;
    }
    await api.clear(libraryID(), LEGACY_SYNC_KEY, { skipDeleteLog: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The live settings notes, newest payload first. Two devices can each create
 * one before either has synced; the newest wins and the rest are trashed.
 */
async function findNotes(): Promise<SettingsNote[]> {
  const tagID = Zotero.Tags.getID(SETTINGS_NOTE_TAG);
  if (!tagID) {
    return [];
  }
  const ids = (await Zotero.Tags.getTagItems(libraryID(), tagID)) as number[];
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  return items
    .filter((item) => item.isNote() && !item.deleted)
    .map((item) => ({ item, payload: decodeSettingsNote(item.getNote()) }))
    .sort((a, b) => (b.payload?.updated ?? -1) - (a.payload?.updated ?? -1));
}

async function newestNote(): Promise<SettingsNote | null> {
  const notes = await findNotes();
  const [newest, ...stale] = notes;
  for (const note of stale) {
    try {
      note.item.deleted = true;
      await note.item.saveTx();
    } catch {
      // Left in place; it simply loses to the newest note again next time.
    }
  }
  return newest ?? null;
}

/**
 * Settings-sync driver: pulls at startup and whenever the settings note
 * arrives or changes through Zotero sync, and pushes (debounced) whenever a
 * synced pref changes. Pushes and pulls are serialised so they never race on
 * the note.
 */
export class SettingsSync {
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private seedTimer: ReturnType<typeof setTimeout> | null = null;
  private observerID: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** `updated` of the payload this session last produced or adopted. */
  private lastSeen = 0;

  constructor(private readonly debounceMs: number = 2000) {}

  /**
   * Clear the legacy row, adopt any synced settings, then watch for the note
   * changing. Awaited at startup before anything reads a pref.
   */
  async start(): Promise<void> {
    await removeLegacySetting();
    await this.pull();
    try {
      this.observerID = Zotero.Notifier.registerObserver(
        { notify: (event, _type, ids) => this.onItemEvent(String(event), ids) },
        ["item"],
        "annotation-compositor-settings",
      );
    } catch {
      // Without the observer, a note synced mid-session is adopted next startup.
    }
    this.seedTimer = setTimeout(() => this.seed(), SEED_DELAY_MS);
  }

  /** Run one note operation after any in flight. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Adopt the note's settings if they are newer than this session's. Returns
   * the number of prefs changed locally; 0 covers "nothing to do", "sync
   * disabled" and "failed".
   */
  pull(): Promise<number> {
    return this.enqueue(async () => {
      if (!getSyncSettings()) {
        return 0;
      }
      try {
        const payload = (await newestNote())?.payload;
        // Never re-apply a payload this session already produced or adopted —
        // that would undo edits made locally since.
        if (!payload || payload.updated <= this.lastSeen) {
          return 0;
        }
        this.lastSeen = payload.updated;
        return applySyncedPrefs(payload.prefs);
      } catch {
        return 0;
      }
    });
  }

  /**
   * Write the local settings to the note, creating it if needed. Skipped when
   * sync is off or the note already holds these exact values — which also
   * stops a pull's own pref writes from echoing straight back up.
   */
  push(): Promise<boolean> {
    return this.enqueue(async () => {
      if (!getSyncSettings()) {
        return false;
      }
      try {
        const note = await newestNote();
        const prefs = collectSyncedPrefs();
        if (note?.payload && samePrefs(note.payload.prefs, prefs)) {
          return false;
        }
        const payload: SyncPayload = {
          version: PAYLOAD_VERSION,
          updated: Date.now(),
          prefs,
        };
        let item = note?.item;
        if (item === undefined) {
          item = new Zotero.Item("note");
          item.libraryID = libraryID();
          item.addTag(SETTINGS_NOTE_TAG, 0);
        }
        item.setNote(encodeSettingsNote(payload));
        this.lastSeen = payload.updated;
        await item.saveTx();
        return true;
      } catch {
        return false;
      }
    });
  }

  /** Coalesce a burst of preference edits into a single push. */
  schedulePush(): void {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, this.debounceMs);
  }

  /**
   * Sync was switched on or off. Switching on adopts the account's settings
   * first, so a stale machine does not overwrite them with its own.
   */
  async onToggle(): Promise<void> {
    if (getSyncSettings()) {
      await this.pull();
      this.schedulePush();
    }
  }

  /**
   * Create the note on the first device, once Zotero's startup sync has had a
   * chance to deliver an existing one — seeding straight away would publish
   * this machine's defaults over the account's real settings.
   */
  private seed(): void {
    this.seedTimer = null;
    const runner = (
      Zotero as unknown as { Sync?: { Runner?: { syncInProgress?: boolean } } }
    ).Sync?.Runner;
    if (runner?.syncInProgress === true) {
      this.seedTimer = setTimeout(() => this.seed(), SEED_RETRY_MS);
      return;
    }
    void this.pull().then(() => this.push());
  }

  private onItemEvent(event: string, ids: readonly (string | number)[]): void {
    if (event !== "add" && event !== "modify") {
      return;
    }
    const touched = ids.some((id) => {
      const item = Zotero.Items.get(Number(id)) as Zotero.Item | false;
      return item && item.isNote() && item.hasTag(SETTINGS_NOTE_TAG);
    });
    if (!touched) {
      return;
    }
    if (this.pullTimer !== null) {
      clearTimeout(this.pullTimer);
    }
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null;
      void this.pull();
    }, PULL_DEBOUNCE_MS);
  }

  /** Flush any pending push and stop the timers and the observer. */
  unregister(): void {
    for (const timer of [this.pullTimer, this.seedTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    this.pullTimer = null;
    this.seedTimer = null;
    if (this.observerID !== null) {
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = null;
    }
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      void this.push();
    }
    this.lastSeen = 0;
  }
}
