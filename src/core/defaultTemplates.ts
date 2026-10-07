/**
 * Shipped export templates. Pure data — no globals, no I/O.
 *
 * `folder` is registered as a self-referencing partial, which is how the
 * renderer walks subfolders to arbitrary depth. Every annotation is printed
 * through `{{{entry}}}` — the user's entry format, already escaped for the
 * output by the export model — so the format preference applies to every
 * preset alike.
 *
 * TeX note: a Mustache tag may not touch a TeX brace (`\section{{{path}}}`
 * parses as a triple-mustache), so TeX templates pad tags with a space:
 * `\section*{ {{path}} }`. LaTeX ignores that space.
 */
import type { EscapeKind } from "./entryFormat.js";

export interface TemplatePreset {
  readonly id: string;
  readonly label: string;
  readonly extension: string;
  readonly mimeType: string;
  /** How `{{name}}` values (and the entry format's placeholders) are escaped. */
  readonly escape: EscapeKind;
  /** TeX presets wrap a standalone document around the preamble preference. */
  readonly standaloneTex?: boolean;
  readonly template: string;
  readonly partials: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- Markdown

const MARKDOWN_ENTRY = `- {{{entry}}}
{{#showComment}}  - {{comment}}
{{/showComment}}`;

const MARKDOWN_FOLDER = `{{#hasAnnotations}}{{#annotations}}{{>entry}}{{/annotations}}
{{/hasAnnotations}}{{#folders}}### {{path}}
{{>folder}}{{/folders}}`;

export const MARKDOWN_PRESET: TemplatePreset = {
  id: "markdown",
  label: "Markdown",
  extension: "md",
  mimeType: "text/markdown",
  escape: "none",
  template: `# {{title}}

{{#folders}}## {{path}}

{{>folder}}
{{/folders}}{{#hasUngrouped}}## Ungrouped

{{#ungrouped}}{{>entry}}{{/ungrouped}}{{/hasUngrouped}}`,
  partials: { folder: MARKDOWN_FOLDER, entry: MARKDOWN_ENTRY },
};

// Group > Label: top-level folders are ##, their labels ###; subfolders ###,
// their labels ####.
const MARKDOWN_LABELS_FOLDER = `### {{path}}

{{#labelGroups}}#### {{label}}

{{#annotations}}{{>entry}}{{/annotations}}
{{/labelGroups}}{{#folders}}{{>folder}}{{/folders}}`;

export const MARKDOWN_LABELS_PRESET: TemplatePreset = {
  id: "markdown-labels",
  label: "Markdown — Group > Label",
  extension: "md",
  mimeType: "text/markdown",
  escape: "none",
  template: `# {{title}}

{{#folders}}## {{path}}

{{#labelGroups}}### {{label}}

{{#annotations}}{{>entry}}{{/annotations}}
{{/labelGroups}}{{#folders}}{{>folder}}{{/folders}}{{/folders}}{{#hasUngrouped}}## Ungrouped

{{#ungroupedLabelGroups}}### {{label}}

{{#annotations}}{{>entry}}{{/annotations}}
{{/ungroupedLabelGroups}}{{/hasUngrouped}}`,
  partials: { folder: MARKDOWN_LABELS_FOLDER, entry: MARKDOWN_ENTRY },
};

// -------------------------------------------------------------------- HTML

const HTML_ENTRY = `<li><span class="ac-swatch" data-color="{{color}}"></span>{{{entry}}}{{#showComment}}<div class="ac-comment">{{comment}}</div>{{/showComment}}</li>
`;

const HTML_FOLDER = `{{#hasAnnotations}}<ul>
{{#annotations}}{{>entry}}{{/annotations}}</ul>
{{/hasAnnotations}}{{#folders}}<section><h3>{{path}}</h3>
{{>folder}}</section>
{{/folders}}`;

export const HTML_PRESET: TemplatePreset = {
  id: "html",
  label: "HTML",
  extension: "html",
  mimeType: "text/html",
  escape: "html",
  template: `<h1>{{title}}</h1>
{{#folders}}<section><h2>{{path}}</h2>
{{>folder}}</section>
{{/folders}}{{#hasUngrouped}}<section><h2>Ungrouped</h2><ul>
{{#ungrouped}}{{>entry}}{{/ungrouped}}</ul></section>
{{/hasUngrouped}}`,
  partials: { folder: HTML_FOLDER, entry: HTML_ENTRY },
};

// --------------------------------------------------------------------- TeX

const TEX_ENTRY = `\\item {{{entry}}}
{{#showComment}}\\begin{itemize}
\\item \\textit{ {{comment}} }
\\end{itemize}
{{/showComment}}`;

const TEX_FOLDER = `{{#hasAnnotations}}\\begin{itemize}
{{#annotations}}{{>entry}}{{/annotations}}\\end{itemize}
{{/hasAnnotations}}{{#folders}}\\subsection*{ {{path}} }
{{>folder}}{{/folders}}`;

// A page break goes before every top-level group but the first, and before
// Ungrouped when any group precedes it.
const TEX_DOCUMENT_START = `{{{preamble}}}

\\begin{document}

\\begin{center}{\\Large\\bfseries {{title}} }\\end{center}

`;

const TEX_UNGROUPED_BREAK = `{{#pageBreak}}{{#hasFolders}}\\newpage
{{/hasFolders}}{{/pageBreak}}`;

const TEX_GROUP_BREAK = `{{#pageBreak}}{{^isFirst}}\\newpage
{{/isFirst}}{{/pageBreak}}`;

export const TEX_PRESET: TemplatePreset = {
  id: "tex",
  label: "TeX (LaTeX)",
  extension: "tex",
  mimeType: "application/x-tex",
  escape: "tex",
  standaloneTex: true,
  template: `${TEX_DOCUMENT_START}{{#folders}}${TEX_GROUP_BREAK}\\section*{ {{path}} }
{{>folder}}
{{/folders}}{{#hasUngrouped}}${TEX_UNGROUPED_BREAK}\\section*{Ungrouped}
\\begin{itemize}
{{#ungrouped}}{{>entry}}{{/ungrouped}}\\end{itemize}
{{/hasUngrouped}}
\\end{document}
`,
  partials: { folder: TEX_FOLDER, entry: TEX_ENTRY },
};

const TEX_LABELS_GROUP = `{{#annotations}}{{>entry}}{{/annotations}}`;

const TEX_LABELS_FOLDER = `\\subsection*{ {{path}} }
{{#labelGroups}}\\subsubsection*{ {{label}} }
\\begin{itemize}
${TEX_LABELS_GROUP}\\end{itemize}
{{/labelGroups}}{{#folders}}{{>folder}}{{/folders}}`;

export const TEX_LABELS_PRESET: TemplatePreset = {
  id: "tex-labels",
  label: "TeX (LaTeX) — Group > Label",
  extension: "tex",
  mimeType: "application/x-tex",
  escape: "tex",
  standaloneTex: true,
  template: `${TEX_DOCUMENT_START}{{#folders}}${TEX_GROUP_BREAK}\\section*{ {{path}} }
{{#labelGroups}}\\subsection*{ {{label}} }
\\begin{itemize}
${TEX_LABELS_GROUP}\\end{itemize}
{{/labelGroups}}{{#folders}}{{>folder}}{{/folders}}
{{/folders}}{{#hasUngrouped}}${TEX_UNGROUPED_BREAK}\\section*{Ungrouped}
{{#ungroupedLabelGroups}}\\subsection*{ {{label}} }
\\begin{itemize}
${TEX_LABELS_GROUP}\\end{itemize}
{{/ungroupedLabelGroups}}{{/hasUngrouped}}
\\end{document}
`,
  partials: { folder: TEX_LABELS_FOLDER, entry: TEX_ENTRY },
};

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  MARKDOWN_PRESET,
  MARKDOWN_LABELS_PRESET,
  HTML_PRESET,
  TEX_PRESET,
  TEX_LABELS_PRESET,
];

export function findPreset(id: string): TemplatePreset {
  return TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? MARKDOWN_PRESET;
}
