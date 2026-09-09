import { describe, expect, it } from "vitest";
import {
  MAX_DEPTH,
  isAtOrBelow,
  isBelow,
  normalizePrefix,
  parseTag,
  validateFolderName,
  validatePath,
  remapKey,
  remapKeys,
} from "../src/core/path.js";

describe("path grammar", () => {
  it("reserves the separator in folder names", () => {
    expect(validateFolderName("Methods/Sampling").ok).toBe(false);
    expect(validateFolderName("  Methods  ")).toEqual({ ok: true, value: "Methods" });
    expect(validateFolderName("   ").ok).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(validateFolderName("methods").value).toBe("methods");
    expect(validateFolderName("Methods").value).toBe("Methods");
  });

  it("caps depth at four levels below the prefix", () => {
    expect(validatePath(["1", "2", "3", "4"]).ok).toBe(true);
    expect(validatePath(["1", "2", "3", "4", "5"]).ok).toBe(false);
    expect(MAX_DEPTH).toBe(4);
  });

  it("parses only well-formed group tags", () => {
    expect(parseTag("grp/A/B", "grp")).toEqual(["A", "B"]);
    expect(parseTag("grp", "grp")).toBeNull();
    expect(parseTag("grp/", "grp")).toBeNull();
    expect(parseTag("grp//B", "grp")).toBeNull();
    expect(parseTag("group/A", "grp")).toBeNull();
    expect(parseTag("grp/1/2/3/4/5", "grp")).toBeNull();
  });

  it("supports a multi-segment prefix", () => {
    expect(parseTag("my/grp/A", "my/grp")).toEqual(["A"]);
    expect(normalizePrefix("  /my/grp/ ")).toEqual({ ok: true, value: "my/grp" });
    expect(normalizePrefix("   ").ok).toBe(false);
  });

  it("answers ancestry questions", () => {
    expect(isAtOrBelow(["A", "B"], ["A"])).toBe(true);
    expect(isAtOrBelow(["A"], ["A"])).toBe(true);
    expect(isBelow(["A"], ["A"])).toBe(false);
    expect(isAtOrBelow(["AB"], ["A"])).toBe(false);
  });
});

describe("remapKey", () => {
  it("moves keys at or below the source onto the target", () => {
    expect(remapKey("A", ["A"], ["B"])).toBe("B");
    expect(remapKey("A/C", ["A"], ["B"])).toBe("B/C");
    expect(remapKey("A/C/D", ["A"], ["X", "A"])).toBe("X/A/C/D");
  });

  it("leaves unrelated keys alone, prefix lookalikes included", () => {
    expect(remapKey("AB", ["A"], ["B"])).toBe("AB");
    expect(remapKey("Z/A", ["A"], ["B"])).toBe("Z/A");
    expect(remapKey("", ["A"], ["B"])).toBe("");
  });

  it("remaps a whole set and deduplicates the result", () => {
    expect(remapKeys(["A", "A/C", "Z"], ["A"], ["B"]).sort()).toEqual(["B", "B/C", "Z"]);
    expect(remapKeys(["A", "B"], ["A"], ["B"])).toEqual(["B"]);
  });
});
