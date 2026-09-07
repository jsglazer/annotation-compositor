import { describe, expect, it } from "vitest";
import {
  MAX_DEPTH,
  isAtOrBelow,
  isBelow,
  normalizePrefix,
  parseTag,
  validateFolderName,
  validatePath,
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
