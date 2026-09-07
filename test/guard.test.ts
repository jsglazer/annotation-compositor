import { describe, expect, it } from "vitest";
import { GUARD_TIMEOUT_MS, NotifierLoopGuard } from "../src/core/guard.js";

function guardWithClock(): { guard: NotifierLoopGuard; tick: (ms: number) => void } {
  let now = 1000;
  const guard = new NotifierLoopGuard({ now: () => now });
  return { guard, tick: (ms: number) => (now += ms) };
}

describe("notifier loop guard", () => {
  it("rejects self-originated modification events deterministically", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1", "a2"]);
    expect(guard.filterEvent(["a1", "a2"])).toEqual([]);
  });

  it("lets foreign events through untouched", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1"]);
    expect(guard.filterEvent(["a1", "user-edit"])).toEqual(["user-edit"]);
  });

  it("increments the write epoch monotonically", () => {
    const { guard } = guardWithClock();
    expect(guard.currentEpoch).toBe(0);
    expect(guard.beginWrite(["a1"])).toBe(1);
    expect(guard.beginWrite(["a2"])).toBe(2);
    expect(guard.currentEpoch).toBe(2);
  });

  it("clears the entry once the matching event drains", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1"]);
    expect(guard.pendingIds).toEqual(["a1"]);
    guard.filterEvent(["a1"]);
    expect(guard.pendingIds).toEqual([]);
    // a later, genuinely foreign event for the same id is no longer swallowed
    expect(guard.filterEvent(["a1"])).toEqual(["a1"]);
  });

  it("drains one event per registered write", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1"]);
    guard.beginWrite(["a1"]);
    expect(guard.filterEvent(["a1"])).toEqual([]);
    expect(guard.filterEvent(["a1"])).toEqual([]);
    expect(guard.filterEvent(["a1"])).toEqual(["a1"]);
  });

  it("releases an undrained entry after the 5s backstop", () => {
    const { guard, tick } = guardWithClock();
    guard.beginWrite(["a1"]);
    tick(GUARD_TIMEOUT_MS - 1);
    expect(guard.filterEvent(["a1"])).toEqual([]);

    guard.beginWrite(["a2"]);
    tick(GUARD_TIMEOUT_MS);
    expect(guard.isSelfOriginated("a2")).toBe(false);
    expect(guard.filterEvent(["a2"])).toEqual(["a2"]); // no deadlock
  });

  it("releases the guard when a transaction rolls back", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1"]);
    guard.cancelWrite(["a1"]);
    expect(guard.filterEvent(["a1"])).toEqual(["a1"]);
  });

  it("forgets everything on reset", () => {
    const { guard } = guardWithClock();
    guard.beginWrite(["a1", "a2"]);
    guard.reset();
    expect(guard.pendingIds).toEqual([]);
  });
});
