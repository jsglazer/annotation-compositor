import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTRY_FORMAT,
  escapeTex,
  formatEntry,
  formatShowsComment,
  parseLabelList,
  passesLabelFilter,
} from "../src/core/entryFormat.js";
import type { EntryValues } from "../src/core/entryFormat.js";
import { DEFAULT_TEX_PREAMBLE, renderPreamble } from "../src/core/texPreamble.js";

const values = (overrides: Partial<EntryValues> = {}): EntryValues => ({
  text: "hypothesis are critical",
  page: "25",
  label: "Yellow",
  comment: "",
  type: "highlight",
  color: "#ffd400",
  author: "",
  date: "",
  tags: "",
  index: "1",
  ...overrides,
});

describe("entry format", () => {
  it("defaults to the pre-1.0.13 '{text} (Color: page)' line", () => {
    expect(formatEntry(DEFAULT_ENTRY_FORMAT, values())).toBe(
      "hypothesis are critical (Yellow: 25)",
    );
    expect(formatEntry("", values({ page: "" }))).toBe(
      "hypothesis are critical (Yellow)",
    );
  });

  it("renders the formats from Update008", () => {
    expect(formatEntry("{page} - {text}", values())).toBe("25 - hypothesis are critical");
    expect(formatEntry("{text} ({page})", values())).toBe("hypothesis are critical (25)");
    expect(formatEntry("{label, page} - {text}", values())).toBe(
      "Yellow, 25 - hypothesis are critical",
    );
  });

  it("joins only the non-empty names of a multi-name placeholder", () => {
    expect(formatEntry("{label, page} - {text}", values({ page: "" }))).toBe(
      "Yellow - hypothesis are critical",
    );
  });

  it("drops an optional segment whose placeholders are all empty", () => {
    expect(formatEntry("{text}[ (p. {page})]", values({ page: "" }))).toBe(
      "hypothesis are critical",
    );
    expect(formatEntry("{text}[ (p. {page})]", values())).toBe(
      "hypothesis are critical (p. 25)",
    );
    expect(formatEntry("\\[{page}\\] {text}", values())).toBe(
      "[25] hypothesis are critical",
    );
  });

  it("escapes values but not the literal format, so TeX markup works", () => {
    expect(
      formatEntry("\\textbf{{label}}: {text}", values({ text: "50% & up" }), "tex"),
    ).toBe("\\textbf{Yellow}: 50\\% \\& up");
    expect(formatEntry("<b>{label}</b> {text}", values({ text: "a<b" }), "html")).toBe(
      "<b>Yellow</b> a&lt;b",
    );
  });

  it("leaves unknown {words} alone", () => {
    expect(formatEntry("{nope} {text}", values())).toBe("{nope} hypothesis are critical");
  });

  it("knows when a format prints the comment itself", () => {
    expect(formatShowsComment(DEFAULT_ENTRY_FORMAT)).toBe(false);
    expect(formatShowsComment("{text}[ — {comment}]")).toBe(true);
  });
});

describe("label filter", () => {
  it("parses a comma list", () => {
    expect(parseLabelList(" Definition, yellow ,, Key point")).toEqual([
      "Definition",
      "yellow",
      "Key point",
    ]);
  });

  it("includes or excludes case-insensitively against any of the names", () => {
    const include = { mode: "include" as const, labels: ["yellow"] };
    expect(passesLabelFilter(include, ["Definition", "Yellow"])).toBe(true);
    expect(passesLabelFilter(include, ["Red"])).toBe(false);
    const exclude = { mode: "exclude" as const, labels: ["definition"] };
    expect(passesLabelFilter(exclude, ["Definition", "Yellow"])).toBe(false);
    expect(passesLabelFilter(exclude, ["Red"])).toBe(true);
  });

  it("passes everything when off or when the list is empty", () => {
    expect(passesLabelFilter({ mode: "off", labels: ["Red"] }, ["Yellow"])).toBe(true);
    expect(passesLabelFilter({ mode: "include", labels: [] }, ["Yellow"])).toBe(true);
    expect(passesLabelFilter(undefined, ["Yellow"])).toBe(true);
  });
});

describe("TeX preamble", () => {
  it("escapes TeX specials", () => {
    expect(escapeTex("a_b {c} $5 #1 ~ ^ \\")).toBe(
      "a\\_b \\{c\\} \\$5 \\#1 \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
    );
  });

  it("substitutes $title$ and keeps the user's document class", () => {
    const out = renderPreamble(DEFAULT_TEX_PREAMBLE, "smith_2020");
    expect(out.startsWith("\\documentclass[12pt,letterpaper]{article}")).toBe(true);
    expect(out).toContain("\\textbf{smith\\_2020}");
    expect(out).not.toContain("$title$");
  });

  it("supplies a document class for a bare Pandoc -H header, and a default for blank", () => {
    expect(renderPreamble("\\usepackage{hyperref}", "T")).toBe(
      "\\documentclass[12pt,letterpaper]{article}\n\\usepackage{hyperref}",
    );
    expect(renderPreamble("  ", "T")).toBe(renderPreamble(DEFAULT_TEX_PREAMBLE, "T"));
  });

  it("matches the default shipped in addon/prefs.js", () => {
    const prefs = readFileSync("addon/prefs.js", "utf8"); // vitest runs from the repo root;
    const line = prefs.split("\n").find((l) => l.includes(".texPreamble"));
    const literal = /,\s*(".*")\);$/.exec(line ?? "")?.[1] ?? '""';
    expect(JSON.parse(literal)).toBe(DEFAULT_TEX_PREAMBLE);
  });
});
