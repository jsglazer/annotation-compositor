import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_RETENTION,
  SnapshotError,
  buildRecoveryPlan,
  createSnapshot,
  parseSnapshot,
  retentionDeletions,
  serializeSnapshot,
} from "../src/core/snapshot.js";
import { PREFIX, annotation, sampleAnnotations } from "./fixtures.js";

const meta = {
  itemKey: "ITEM1",
  createdAt: "2026-09-07T12:00:00.000Z",
  reason: "pre-rename",
};

describe("snapshot serializer", () => {
  it("captures group tags only, sorted, per annotation", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    expect(snapshot.entries[0]).toEqual({
      id: "a1",
      tags: ["grp/Methods", "grp/Methods/Sampling"], // "keep-me" excluded
    });
    expect(snapshot.entries.map((e) => e.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(snapshot.tagType).toBe(0); // manual by default
  });

  it("round-trips through JSON exactly", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    const json = serializeSnapshot(snapshot);
    const parsed = parseSnapshot(json);
    expect(parsed).toEqual(snapshot);
    expect(serializeSnapshot(parsed)).toBe(json);
  });

  it("rejects corrupt snapshot files", () => {
    expect(() => parseSnapshot("not json")).toThrow(SnapshotError);
    expect(() => parseSnapshot("[]")).toThrow(SnapshotError);
    expect(() => parseSnapshot(JSON.stringify({ version: 99, entries: [] }))).toThrow(
      SnapshotError,
    );
    expect(() =>
      parseSnapshot(
        JSON.stringify({ version: 1, itemKey: "K", prefix: "grp", createdAt: "t" }),
      ),
    ).toThrow(SnapshotError);
    expect(() =>
      parseSnapshot(
        JSON.stringify({
          version: 1,
          itemKey: "K",
          prefix: "grp",
          createdAt: "t",
          entries: [{ id: "a1", tags: [7] }],
        }),
      ),
    ).toThrow(SnapshotError);
  });

  it("plans a full recovery from a total tag wipe", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    // simulate "Delete Automatic Tags in This Library": every group tag gone
    const wiped = sampleAnnotations().map((a) => ({
      ...a,
      tags: a.tags.filter((tag) => !tag.startsWith("grp/")),
    }));
    const plan = buildRecoveryPlan(snapshot, wiped);
    expect(plan.removeCount).toBe(0);
    expect(plan.addCount).toBe(6);
    expect(plan.diff.map((e) => e.itemId)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(plan.missingIds).toEqual([]);
    expect(plan.unknownIds).toEqual([]);
  });

  it("plans an empty recovery when nothing changed", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    expect(buildRecoveryPlan(snapshot, sampleAnnotations()).diff).toEqual([]);
  });

  it("removes tags added since the snapshot and reports deleted annotations", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    const current = sampleAnnotations()
      .filter((a) => a.id !== "a3")
      .map((a) => (a.id === "a4" ? { ...a, tags: [...a.tags, "grp/Extra"] } : a));
    const plan = buildRecoveryPlan(snapshot, current);
    expect(plan.diff).toEqual([{ itemId: "a4", add: [], remove: ["grp/Extra"] }]);
    expect(plan.missingIds).toEqual(["a3"]);
  });

  it("leaves annotations created after the snapshot untouched", () => {
    const snapshot = createSnapshot(sampleAnnotations(), PREFIX, meta);
    const current = [...sampleAnnotations(), annotation("new1", ["grp/Later"])];
    const plan = buildRecoveryPlan(snapshot, current);
    expect(plan.diff).toEqual([]);
    expect(plan.unknownIds).toEqual(["new1"]);
  });

  it("keeps the newest N snapshots and deletes the rest", () => {
    const names = [
      "2026-09-01T00-00-00Z.json",
      "2026-09-02T00-00-00Z.json",
      "2026-09-03T00-00-00Z.json",
    ];
    expect(retentionDeletions(names, 2)).toEqual(["2026-09-01T00-00-00Z.json"]);
    expect(retentionDeletions(names, 5)).toEqual([]);
    expect(SNAPSHOT_RETENTION).toBe(20);
  });

  it("does not mutate its input", () => {
    const annotations = sampleAnnotations();
    const before = JSON.stringify(annotations);
    const snapshot = createSnapshot(annotations, PREFIX, meta);
    buildRecoveryPlan(snapshot, annotations);
    expect(JSON.stringify(annotations)).toBe(before);
  });
});
