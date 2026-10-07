import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/core/template.js";
import {
  MARKDOWN_LABELS_PRESET,
  MARKDOWN_PRESET,
  TEMPLATE_PRESETS,
  TEX_LABELS_PRESET,
  TEX_PRESET,
} from "../src/core/defaultTemplates.js";
import type { TemplatePreset } from "../src/core/defaultTemplates.js";
import { escaperFor } from "../src/core/entryFormat.js";
import type { LabelFilter } from "../src/core/entryFormat.js";
import { buildExportContext } from "../src/core/exportModel.js";
import { renderPreamble } from "../src/core/texPreamble.js";
import { PREFIX, annotation } from "./fixtures.js";

const YELLOW = "#ffd400";
const RED = "#ff6666";

const records = [
  annotation("a", ["grp/Methods"], { color: YELLOW, text: "alpha", pageLabel: "3" }),
  annotation("b", ["grp/Methods"], { color: RED, text: "beta & co", pageLabel: "4" }),
  annotation("c", ["grp/Methods"], { color: YELLOW, text: "gamma", pageLabel: "5" }),
  annotation("d", ["grp/Results"], { color: RED, text: "delta", comment: "50% sure" }),
  annotation("e", [], { color: YELLOW, text: "loose" }),
];

function render(
  preset: TemplatePreset,
  options: { entryFormat?: string; labelFilter?: LabelFilter; pageBreak?: boolean } = {},
): string {
  const context = buildExportContext(records, PREFIX, {
    selectedPaths: [["Methods"], ["Results"]],
    includeUngrouped: true,
    title: "Doc_1",
    colorLabels: { Yellow: "Definition" },
    entryEscape: preset.escape,
    ...options,
  });
  const preamble = preset.standaloneTex === true ? renderPreamble("", "Doc_1") : "";
  return renderTemplate(
    preset.template,
    { ...context, preamble },
    { partials: preset.partials, escape: escaperFor(preset.escape) },
  );
}

describe("entry format applies to every preset", () => {
  it.each(TEMPLATE_PRESETS.map((preset) => [preset.id, preset] as const))(
    "%s",
    (_id, preset) => {
      const out = render(preset, { entryFormat: "{page} - {text}" });
      expect(out).toContain("3 - alpha");
    },
  );
});

describe("label filter", () => {
  it("keeps only the included labels, by custom or built-in name", () => {
    const custom = render(MARKDOWN_PRESET, {
      labelFilter: { mode: "include", labels: ["definition"] },
    });
    const builtIn = render(MARKDOWN_PRESET, {
      labelFilter: { mode: "include", labels: ["Yellow"] },
    });
    for (const out of [custom, builtIn]) {
      expect(out).toContain("alpha");
      expect(out).toContain("loose");
      expect(out).not.toContain("beta");
    }
  });

  it("drops the excluded labels", () => {
    const out = render(MARKDOWN_PRESET, {
      labelFilter: { mode: "exclude", labels: ["Red"] },
    });
    expect(out).toContain("gamma");
    expect(out).not.toContain("delta");
  });
});

describe("Group > Label presets", () => {
  it("groups each folder's annotations by colour label (markdown)", () => {
    const out = render(MARKDOWN_LABELS_PRESET);
    const methods = out.slice(out.indexOf("## Methods"), out.indexOf("## Results"));
    expect(methods).toContain("### Definition");
    expect(methods).toContain("### Red");
    // both Definition entries sit under one heading, before the Red one
    expect(methods.indexOf("gamma")).toBeLessThan(methods.indexOf("### Red"));
    expect(out).toContain("## Ungrouped\n\n### Definition");
  });

  it("groups by label in TeX", () => {
    const out = render(TEX_LABELS_PRESET);
    expect(out).toContain("\\section*{ Methods }\n\\subsection*{ Definition }");
  });
});

describe("TeX export", () => {
  it("is a standalone document with the preamble and escaped values", () => {
    const out = render(TEX_PRESET);
    expect(out.startsWith("\\documentclass[12pt,letterpaper]{article}")).toBe(true);
    expect(out).toContain("\\textbf{Doc\\_1}"); // $title$ in the running header
    expect(out).toContain("\\begin{document}");
    expect(out.trimEnd().endsWith("\\end{document}")).toBe(true);
    expect(out).toContain("\\item beta \\& co (Red: 4)");
    expect(out).toContain("\\textit{ 50\\% sure }");
    expect(out).toContain("{\\Large\\bfseries Doc\\_1 }");
  });

  it("puts \\newpage between top-level groups only when asked", () => {
    expect(render(TEX_PRESET)).not.toContain("\\newpage");
    const out = render(TEX_PRESET, { pageBreak: true });
    // Methods (first) has none; Results and Ungrouped each get one.
    expect(out.match(/\\newpage/g)).toHaveLength(2);
    expect(out.indexOf("\\newpage")).toBeGreaterThan(
      out.indexOf("\\section*{ Methods }"),
    );
    expect(
      render(TEX_LABELS_PRESET, { pageBreak: true }).match(/\\newpage/g),
    ).toHaveLength(2);
  });

  it("never emits an empty itemize", () => {
    for (const preset of [TEX_PRESET, TEX_LABELS_PRESET]) {
      expect(render(preset)).not.toMatch(/\\begin\{itemize\}\s*\\end\{itemize\}/);
    }
  });
});
