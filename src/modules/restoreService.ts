/**
 * "Restore previous grouping" — the only undo affordance in v1.
 *
 * Always shows the diff preview before writing, and the restore itself is
 * snapshot-backed like every other write, so it can be undone in turn.
 */
import { countMutations } from "../core/rewrite.js";
import type { Snapshot } from "../core/snapshot.js";
import { alert, confirm, select } from "../adapters/dialogs.js";
import type { GroupService } from "./groupService.js";

export class RestoreService {
  constructor(private readonly service: GroupService) {}

  async run(item: Zotero.Item): Promise<boolean> {
    const stored = await this.service.listSnapshots(item);
    if (stored.length === 0) {
      alert("Restore grouping", "No snapshots have been taken for this item yet.");
      return false;
    }
    const index = select(
      "Restore grouping",
      "Choose a snapshot to restore:",
      stored.map(
        (entry) =>
          `${entry.snapshot.createdAt} — ${entry.snapshot.reason} (${entry.snapshot.entries.length} annotations)`,
      ),
    );
    if (index === null) {
      return false;
    }
    const snapshot: Snapshot = stored[index].snapshot;
    const plan = this.service.previewRestore(item, snapshot);
    if (plan.diff.length === 0) {
      alert(
        "Restore grouping",
        "This snapshot matches the current grouping — nothing to do.",
      );
      return false;
    }
    const preview = plan.diff
      .slice(0, 20)
      .map((entry) =>
        `${entry.itemId}: ${entry.add.map((tag) => `+${tag}`).join(" ")} ${entry.remove
          .map((tag) => `-${tag}`)
          .join(" ")}`.trim(),
      )
      .join("\n");
    const more = plan.diff.length > 20 ? `\n… and ${plan.diff.length - 20} more` : "";
    const missing =
      plan.missingIds.length > 0
        ? `\n${plan.missingIds.length} annotation(s) in the snapshot no longer exist.`
        : "";
    const unknown =
      plan.unknownIds.length > 0
        ? `\n${plan.unknownIds.length} annotation(s) created since the snapshot will be left untouched.`
        : "";

    if (
      !confirm(
        "Restore grouping",
        `${countMutations(plan.diff)} tag change(s) across ${plan.diff.length} annotation(s):\n\n${preview}${more}${missing}${unknown}`,
      )
    ) {
      return false;
    }
    const outcome = await this.service.restore(item, snapshot);
    if (!outcome.ok) {
      alert("Restore grouping", outcome.error ?? "The restore could not be completed.");
      return false;
    }
    ztoolkit.notify(
      "Annotation Compositor",
      `Restored ${outcome.mutationCount} tag change(s).`,
    );
    return true;
  }
}
