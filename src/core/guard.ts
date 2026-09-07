/**
 * Notifier re-entrancy guard.
 * Pure: no globals, no I/O — the clock is injected, so tests are deterministic
 * without fake timers.
 *
 * The mechanism is fixed by decision: a Set of annotation item ids written by
 * the plugin, paired with a monotonically incremented write epoch. Entries are
 * cleared when the matching notifier event drains, with a 5-second timeout
 * backstop so a dropped event cannot deadlock the guard.
 */

export const GUARD_TIMEOUT_MS = 5000;

interface PendingWrite {
  /** Epoch of the most recent write that registered this id. */
  epoch: number;
  /** Outstanding notifier events still expected for this id. */
  count: number;
  /** Absolute time after which the entry is swept even if no event arrived. */
  expiresAt: number;
}

export interface GuardOptions {
  /** Monotonic clock in milliseconds. Injected so tests control time. */
  readonly now?: () => number;
  /** Backstop after which an undrained entry is discarded. */
  readonly timeoutMs?: number;
}

export class NotifierLoopGuard {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingWrite>();
  private epoch = 0;

  constructor(options: GuardOptions = {}) {
    this.now = options.now ?? (() => 0);
    this.timeoutMs = options.timeoutMs ?? GUARD_TIMEOUT_MS;
  }

  /** The last epoch handed out. Monotonic, never reused. */
  get currentEpoch(): number {
    return this.epoch;
  }

  /** Ids still awaiting their own notifier event, sorted. */
  get pendingIds(): string[] {
    return [...this.pending.keys()].sort();
  }

  /**
   * Register a plugin-originated write. Call this inside the transaction,
   * before the tags are saved, so no event can arrive unguarded.
   */
  beginWrite(itemIds: readonly string[]): number {
    this.sweep();
    this.epoch += 1;
    const expiresAt = this.now() + this.timeoutMs;
    for (const id of itemIds) {
      const existing = this.pending.get(id);
      if (existing === undefined) {
        this.pending.set(id, { epoch: this.epoch, count: 1, expiresAt });
      } else {
        existing.epoch = this.epoch;
        existing.count += 1;
        existing.expiresAt = expiresAt;
      }
    }
    return this.epoch;
  }

  /** Discard a registration whose transaction rolled back. */
  cancelWrite(itemIds: readonly string[]): void {
    for (const id of itemIds) {
      this.drainOne(id);
    }
  }

  /** True when `id` is currently expected back as a self-triggered event. */
  isSelfOriginated(itemId: string): boolean {
    this.sweep();
    return this.pending.has(itemId);
  }

  /**
   * Filter a notifier event down to the ids the plugin did NOT write, draining
   * the matching guard entries as it goes. Self-originated ids are rejected
   * deterministically: the same event, replayed, is rejected exactly once.
   */
  filterEvent(itemIds: readonly string[]): string[] {
    this.sweep();
    const foreign: string[] = [];
    for (const id of itemIds) {
      if (!this.drainOne(id)) {
        foreign.push(id);
      }
    }
    return foreign;
  }

  /** Drop entries past the timeout backstop. Returns how many were dropped. */
  sweep(): number {
    const cutoff = this.now();
    let dropped = 0;
    for (const [id, entry] of this.pending) {
      if (entry.expiresAt <= cutoff) {
        this.pending.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Forget every registration (plugin shutdown). */
  reset(): void {
    this.pending.clear();
  }

  private drainOne(itemId: string): boolean {
    const entry = this.pending.get(itemId);
    if (entry === undefined) {
      return false;
    }
    entry.count -= 1;
    if (entry.count <= 0) {
      this.pending.delete(itemId);
    }
    return true;
  }
}
