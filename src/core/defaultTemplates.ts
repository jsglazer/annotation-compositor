/**
 * Shipped export templates. Pure data — no globals, no I/O.
 *
 * `folder` is registered as a self-referencing partial, which is how the
 * renderer walks subfolders to arbitrary depth.
 */

export interface TemplatePreset {
  readonly id: string;
  readonly label: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly template: string;
  readonly partials: Readonly<Record<string, string>>;
}

const MARKDOWN_FOLDER = `{{#hasAnnotations}}{{#annotations}}- {{#hasText}}{{text}}{{/hasText}}{{^hasText}}({{type}}){{/hasText}} ({{colorLabel}}{{#pageLabel}}: {{pageLabel}}{{/pageLabel}})
{{#hasComment}}  - {{comment}}
{{/hasComment}}{{/annotations}}
{{/hasAnnotations}}{{#folders}}{{#depth}}{{/depth}}### {{path}}
{{>folder}}{{/folders}}`;

const HTML_FOLDER = `{{#hasAnnotations}}<ul>
{{#annotations}}<li><span class="ac-swatch" data-color="{{color}}"></span>{{#hasText}}{{text}}{{/hasText}}{{^hasText}}({{type}}){{/hasText}} <em>{{colorLabel}}{{#pageLabel}}: {{pageLabel}}{{/pageLabel}}</em>{{#hasComment}}<div class="ac-comment">{{comment}}</div>{{/hasComment}}</li>
{{/annotations}}</ul>
{{/hasAnnotations}}{{#folders}}<section><h3>{{path}}</h3>
{{>folder}}</section>
{{/folders}}`;

export const MARKDOWN_PRESET: TemplatePreset = {
  id: "markdown",
  label: "Markdown",
  extension: "md",
  mimeType: "text/markdown",
  template: `# {{title}}

{{#folders}}## {{path}}

{{>folder}}
{{/folders}}{{#hasUngrouped}}## Ungrouped

{{#ungrouped}}- {{#hasText}}{{text}}{{/hasText}}{{^hasText}}({{type}}){{/hasText}} ({{colorLabel}}{{#pageLabel}}: {{pageLabel}}{{/pageLabel}})
{{#hasComment}}  - {{comment}}
{{/hasComment}}{{/ungrouped}}{{/hasUngrouped}}`,
  partials: { folder: MARKDOWN_FOLDER },
};

export const HTML_PRESET: TemplatePreset = {
  id: "html",
  label: "HTML",
  extension: "html",
  mimeType: "text/html",
  template: `<h1>{{title}}</h1>
{{#folders}}<section><h2>{{path}}</h2>
{{>folder}}</section>
{{/folders}}{{#hasUngrouped}}<section><h2>Ungrouped</h2><ul>
{{#ungrouped}}<li>{{#hasText}}{{text}}{{/hasText}}{{^hasText}}({{type}}){{/hasText}} <em>{{colorLabel}}{{#pageLabel}}: {{pageLabel}}{{/pageLabel}}</em>{{#hasComment}}<div class="ac-comment">{{comment}}</div>{{/hasComment}}</li>
{{/ungrouped}}</ul></section>
{{/hasUngrouped}}`,
  partials: { folder: HTML_FOLDER },
};

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [MARKDOWN_PRESET, HTML_PRESET];

export function findPreset(id: string): TemplatePreset {
  return TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? MARKDOWN_PRESET;
}
