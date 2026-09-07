import { describe, expect, it } from "vitest";
import {
  MENU_COLLAPSE_THRESHOLD,
  buildMenuModel,
  flattenEntries,
} from "../src/core/menuModel.js";
import type { FolderPath } from "../src/core/types.js";

const paths: FolderPath[] = [
  ["Methods"],
  ["Methods", "Sampling"],
  ["Methods", "Sampling", "Bias"],
  ["Results"],
];

describe("context menu model", () => {
  it("nests when the capability probe reports submenu support", () => {
    const model = buildMenuModel(paths, { nestedSupported: true });
    expect(model.shape).toBe("nested");
    const methods = model.entries[0];
    expect(methods.kind).toBe("submenu");
    if (methods.kind === "submenu") {
      expect(methods.selfEntry).toEqual({
        kind: "folder",
        label: "This folder",
        path: ["Methods"],
      });
      expect(methods.children[0].label).toBe("Sampling");
    }
  });

  it("falls back to flat 'A > B > C' labels when submenus are unsupported", () => {
    const model = buildMenuModel(paths, { nestedSupported: false });
    expect(model.shape).toBe("flat");
    expect(model.entries.map((entry) => entry.label)).toEqual([
      "Methods",
      "Methods > Sampling",
      "Methods > Sampling > Bias",
      "Results",
      "New folder…",
    ]);
  });

  it("collapses to recents plus More… above the folder threshold", () => {
    const many: FolderPath[] = Array.from(
      { length: MENU_COLLAPSE_THRESHOLD + 1 },
      (_, i) => [`F${String(i).padStart(2, "0")}`],
    );
    const model = buildMenuModel(many, {
      nestedSupported: true,
      recentKeys: ["F03", "F01", "nope"],
    });
    expect(model.shape).toBe("collapsed");
    expect(model.entries.map((entry) => entry.label)).toEqual([
      "F03",
      "F01",
      "More…",
      "New folder…",
    ]);
  });

  it("flattens a nested model for the fallback path", () => {
    const nested = buildMenuModel(paths, { nestedSupported: true });
    expect(flattenEntries(nested.entries).map((entry) => entry.label)).toEqual([
      "Methods",
      "Methods > Sampling",
      "Methods > Sampling > Bias",
      "Results",
      "New folder…",
    ]);
  });
});
