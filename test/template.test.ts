import { describe, expect, it } from "vitest";
import { TemplateError, parseTemplate, renderTemplate } from "../src/core/template.js";
import { HTML_PRESET, MARKDOWN_PRESET } from "../src/core/defaultTemplates.js";
import { buildExportContext } from "../src/core/exportModel.js";
import { PREFIX, annotation, sampleAnnotations } from "./fixtures.js";

describe("mustache subset", () => {
  it("substitutes {{var}} with HTML escaping", () => {
    expect(renderTemplate("Hi {{name}}", { name: "<b>&x</b>" })).toBe(
      "Hi &lt;b&gt;&amp;x&lt;/b&gt;",
    );
  });

  it("renders {{{var}}} and {{&var}} raw", () => {
    expect(renderTemplate("{{{a}}}|{{&a}}", { a: "<i>" })).toBe("<i>|<i>");
  });

  it("renders missing values as empty", () => {
    expect(renderTemplate("[{{nope}}]", {})).toBe("[]");
  });

  it("iterates {{#section}} over arrays with the implicit iterator", () => {
    expect(renderTemplate("{{#xs}}<{{.}}>{{/xs}}", { xs: ["a", "b"] })).toBe("<a><b>");
  });

  it("renders {{#section}} once for a truthy non-array and pushes its context", () => {
    expect(renderTemplate("{{#o}}{{v}}{{/o}}", { o: { v: 7 } })).toBe("7");
    expect(renderTemplate("{{#o}}x{{/o}}", { o: false })).toBe("");
    expect(renderTemplate("{{#o}}x{{/o}}", { o: [] })).toBe("");
  });

  it("renders {{^inverted}} for falsy, empty-string and empty-array values", () => {
    expect(renderTemplate("{{^a}}none{{/a}}", { a: [] })).toBe("none");
    expect(renderTemplate("{{^a}}none{{/a}}", { a: "" })).toBe("none");
    expect(renderTemplate("{{^a}}none{{/a}}", { a: 0 })).toBe("");
    expect(renderTemplate("{{^a}}none{{/a}}", { a: ["x"] })).toBe("");
  });

  it("drops comments and resolves dotted names up the context stack", () => {
    expect(renderTemplate("{{! ignored }}{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe(
      "deep",
    );
    expect(renderTemplate("{{#xs}}{{outer}}{{/xs}}", { outer: "O", xs: [1] })).toBe("O");
  });

  it("traverses subfolders through a self-referencing partial", () => {
    const tree = {
      folders: [
        { name: "A", folders: [{ name: "A1", folders: [{ name: "A1a", folders: [] }] }] },
      ],
    };
    const out = renderTemplate("{{>folder}}", tree, {
      partials: { folder: "{{#folders}}[{{name}}{{>folder}}]{{/folders}}" },
    });
    expect(out).toBe("[A[A1[A1a]]]");
  });

  it("caps runaway recursion instead of hanging", () => {
    expect(() =>
      renderTemplate(
        "{{>self}}",
        { x: 1 },
        { partials: { self: "{{>self}}" }, maxDepth: 20 },
      ),
    ).toThrow(TemplateError);
  });

  it("rejects mismatched and unclosed sections", () => {
    expect(() => parseTemplate("{{#a}}x{{/b}}")).toThrow(TemplateError);
    expect(() => parseTemplate("{{#a}}x")).toThrow(TemplateError);
  });

  it("renders the shipped Markdown preset in annotationSortIndex order", () => {
    const annotations = [
      annotation("z", ["grp/A"], { sortIndex: "00005|000000|00000", text: "second" }),
      annotation("y", ["grp/A"], { sortIndex: "00001|000000|00000", text: "first" }),
      annotation("x", ["grp/A/B"], { sortIndex: "00002|000000|00000", text: "child" }),
    ];
    const context = buildExportContext(annotations, PREFIX, {
      selectedPaths: [["A"]],
      includeSubfolders: true,
      title: "Doc",
    });
    const out = renderTemplate(MARKDOWN_PRESET.template, context, {
      partials: MARKDOWN_PRESET.partials,
    });
    expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
    expect(out).toContain("### A/B");
    expect(out).toContain("child");
    expect(out).toContain("# Doc");
  });

  it("is deterministic: the same input renders byte-identically", () => {
    const context = buildExportContext(sampleAnnotations(), PREFIX, {
      selectedPaths: [["Methods"], ["Results"]],
      includeUngrouped: true,
    });
    const once = renderTemplate(MARKDOWN_PRESET.template, context, {
      partials: MARKDOWN_PRESET.partials,
    });
    const twice = renderTemplate(MARKDOWN_PRESET.template, context, {
      partials: MARKDOWN_PRESET.partials,
    });
    expect(once).toBe(twice);
  });
});

describe("shipped presets carry annotation comments", () => {
  const withComments = [
    annotation("g1", ["grp/A"], { comment: "grouped note" }),
    annotation("u1", [], { comment: "ungrouped note" }),
  ];

  const render = (preset: typeof MARKDOWN_PRESET): string =>
    renderTemplate(
      preset.template,
      buildExportContext(withComments, PREFIX, {
        selectedPaths: [["A"]],
        includeUngrouped: true,
      }),
      preset.partials,
    );

  it("emits comments for grouped AND ungrouped annotations (markdown)", () => {
    const out = render(MARKDOWN_PRESET);
    expect(out).toContain("grouped note");
    expect(out).toContain("ungrouped note");
  });

  it("emits comments for grouped AND ungrouped annotations (html)", () => {
    const out = render(HTML_PRESET);
    expect(out).toContain("grouped note");
    expect(out).toContain("ungrouped note");
  });
});
