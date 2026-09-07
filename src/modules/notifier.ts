/**
 * Zotero.Notifier subscription.
 *
 * Two defences against re-entrancy, in this order:
 *   1. the explicit loop guard — a Set of annotation ids the plugin wrote,
 *      paired with a write epoch (see `core/guard.ts`); and
 *   2. the `annotationCompositor` marker Zotero carries back in `extraData`.
 * An event that survives both is a genuine user edit, and only then does the
 * panel re-render (debounced at 150ms) or a colour rule fire.
 */
import type { NotifierLoopGuard } from "../core/guard.js";
import { newAnnotationDiff } from "../core/rules.js";
import { NOTIFIER_MARKER } from "../adapters/tagWriter.js";

export const RERENDER_DEBOUNCE_MS = 150;

export interface NotifierHooks {
  /** Called after debounce when foreign annotation changes land. */
  readonly onRefresh: () => void;
  /** Called for annotations created by the user, for colour/sticky assignment. */
  readonly onAnnotationsCreated: (annotations: Zotero.Item[]) => Promise<void>;
}

export class NotifierService {
  private observerID: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly guard: NotifierLoopGuard,
    private readonly hooks: NotifierHooks,
    private readonly debounceMs: number = RERENDER_DEBOUNCE_MS,
  ) {}

  register(): void {
    if (this.observerID !== null) {
      return;
    }
    this.observerID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids, extraData) =>
          this.handle(String(event), String(type), ids, extraData),
      },
      ["item"],
      "annotation-compositor",
    );
  }

  unregister(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.observerID !== null) {
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = null;
    }
    this.guard.reset();
  }

  private async handle(
    event: string,
    type: string,
    ids: readonly (string | number)[],
    extraData: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (type !== "item") {
      return;
    }
    const items = Zotero.Items.get(ids.map((id) => Number(id))).filter((item) =>
      item.isAnnotation(),
    );
    if (items.length === 0) {
      return;
    }

    // Defence 2: our own writes carry a marker in extraData.
    const selfMarked = items.filter((item) => {
      const data = extraData?.[String(item.id)] as Record<string, unknown> | undefined;
      return data?.[NOTIFIER_MARKER] === true;
    });
    const marked = new Set(selfMarked.map((item) => item.key));

    // Defence 1: the explicit loop guard, drained by this event.
    const foreignKeys = new Set(this.guard.filterEvent(items.map((item) => item.key)));
    const foreign = items.filter(
      (item) => foreignKeys.has(item.key) && !marked.has(item.key),
    );
    if (foreign.length === 0) {
      return;
    }

    if (event === "add") {
      await this.hooks.onAnnotationsCreated(foreign);
    }
    this.scheduleRefresh();
  }

  /** Coalesce bursts of annotation edits into one re-render. */
  private scheduleRefresh(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.hooks.onRefresh();
    }, this.debounceMs);
  }
}

export { newAnnotationDiff };
