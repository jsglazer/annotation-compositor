import { describe, expect, it, vi } from "vitest";

import { StickyGroupRegistry } from "../src/adapters/reader.js";

describe("StickyGroupRegistry", () => {
  it("keeps pins apart per item", () => {
    const registry = new StickyGroupRegistry();
    registry.set("ITEMA", ["C. TRADITIONAL THEORY"]);
    expect(registry.get("ITEMA")).toEqual(["C. TRADITIONAL THEORY"]);
    expect(registry.get("ITEMB")).toBeNull();
  });

  it("round-trips through a persisted map", () => {
    const first = new StickyGroupRegistry();
    first.set("ITEMA", ["Theory", "Classical"]);
    const second = new StickyGroupRegistry(first.toJSON());
    expect(second.get("ITEMA")).toEqual(["Theory", "Classical"]);
  });

  it("persists on every change, not only at shutdown", () => {
    const onChange = vi.fn();
    const registry = new StickyGroupRegistry({}, onChange);
    registry.set("ITEMA", ["Theory"]);
    expect(onChange).toHaveBeenCalledWith({ ITEMA: ["Theory"] });
    registry.set("ITEMA", null);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("ignores junk in a stored map", () => {
    const registry = new StickyGroupRegistry({
      ITEMA: ["Theory"],
      ITEMB: [] as string[],
      ITEMC: "not-a-path" as unknown as string[],
    });
    expect(registry.toJSON()).toEqual({ ITEMA: ["Theory"] });
  });

  it("adopting a stored map does not write it back out", () => {
    const onChange = vi.fn();
    const registry = new StickyGroupRegistry({}, onChange);
    registry.adopt({ ITEMA: ["Theory"] });
    expect(registry.get("ITEMA")).toEqual(["Theory"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows a renamed or reparented folder", () => {
    const registry = new StickyGroupRegistry();
    registry.set("ITEMA", ["Theory", "Classical"]);
    registry.remap("ITEMA", ["Theory"], ["Notes", "Theory"]);
    expect(registry.get("ITEMA")).toEqual(["Notes", "Theory", "Classical"]);
  });

  it("leaves a pin on an unrelated folder alone", () => {
    const registry = new StickyGroupRegistry();
    registry.set("ITEMA", ["Method"]);
    registry.remap("ITEMA", ["Theory"], ["Notes", "Theory"]);
    expect(registry.get("ITEMA")).toEqual(["Method"]);
  });
});
