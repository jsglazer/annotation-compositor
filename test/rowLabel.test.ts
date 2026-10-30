import { describe, expect, it } from "vitest";
import { formatRowPage, ROW_TEXT_MAX, truncateRowText } from "../src/core/rowLabel.js";

describe("truncateRowText", () => {
  it("leaves text of 50 characters or fewer untouched", () => {
    expect(truncateRowText("campaign finance scores (CFscores)")).toBe(
      "campaign finance scores (CFscores)",
    );
    const exact = "x".repeat(ROW_TEXT_MAX);
    expect(truncateRowText(exact)).toBe(exact);
  });

  it("cuts longer text to 50 characters plus an ellipsis", () => {
    const long = "a".repeat(ROW_TEXT_MAX + 10);
    expect(truncateRowText(long)).toBe(`${"a".repeat(ROW_TEXT_MAX)}…`);
  });

  it("drops trailing whitespace before the ellipsis", () => {
    const text = `${"a".repeat(ROW_TEXT_MAX - 1)} and more`;
    expect(truncateRowText(text)).toBe(`${"a".repeat(ROW_TEXT_MAX - 1)}…`);
  });

  it("does not split astral characters", () => {
    const text = "😀".repeat(ROW_TEXT_MAX + 1);
    expect(truncateRowText(text)).toBe(`${"😀".repeat(ROW_TEXT_MAX)}…`);
  });
});

describe("formatRowPage", () => {
  it("wraps the page label in parentheses without a 'p.' prefix", () => {
    expect(formatRowPage("367")).toBe("(367)");
  });

  it("is empty when there is no page label", () => {
    expect(formatRowPage("")).toBe("");
  });
});
