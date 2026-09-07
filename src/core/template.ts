/**
 * Mustache-subset template engine.
 * Pure: no globals, no I/O, no DOM. Deterministic for a given template+context.
 *
 * Supported: `{{name}}` (HTML-escaped), `{{{name}}}` and `{{&name}}` (raw),
 * `{{#section}}…{{/section}}` (array iteration / truthy block),
 * `{{^section}}…{{/section}}` (inverted), `{{! comment}}`, `{{>partial}}`
 * (which is how subfolder traversal recurses), dotted names (`a.b.c`) and the
 * implicit iterator `{{.}}`.
 *
 * Deliberately NOT supported: lambdas, set delimiters, partial indentation.
 */

type Node =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "var"; readonly name: string; readonly escape: boolean }
  | { readonly kind: "partial"; readonly name: string }
  | {
      readonly kind: "section";
      readonly name: string;
      readonly inverted: boolean;
      readonly children: Node[];
    };

export type TemplateValue = unknown;
export type TemplateContext = Record<string, TemplateValue>;

export interface RenderOptions {
  /** Named partials; a partial may reference itself to walk a folder tree. */
  readonly partials?: Readonly<Record<string, string>>;
  /** Guard against a runaway self-referencing partial. */
  readonly maxDepth?: number;
}

export class TemplateError extends Error {}

const TAG = /\{\{(!|&|\{|#|\^|\/|>)?\s*([^}]*?)\s*\}?\}\}/g;

/** Parse a template into an AST. Throws {@link TemplateError} on mismatched tags. */
export function parseTemplate(template: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [];
  let children = root;
  let cursor = 0;

  TAG.lastIndex = 0;
  let match = TAG.exec(template);
  while (match !== null) {
    if (match.index > cursor) {
      children.push({ kind: "text", value: template.slice(cursor, match.index) });
    }
    cursor = match.index + match[0].length;
    const sigil = match[1] ?? "";
    const name = match[2];

    if (sigil === "!") {
      // comment: emit nothing
    } else if (sigil === "#" || sigil === "^") {
      const section: Node = {
        kind: "section",
        name,
        inverted: sigil === "^",
        children: [],
      };
      children.push(section);
      stack.push({ name, children });
      children = section.children;
    } else if (sigil === "/") {
      const open = stack.pop();
      if (open === undefined || open.name !== name) {
        throw new TemplateError(
          `Unexpected {{/${name}}}${open === undefined ? "" : ` — {{#${open.name}}} is still open`}.`,
        );
      }
      children = open.children;
    } else if (sigil === ">") {
      children.push({ kind: "partial", name });
    } else {
      children.push({ kind: "var", name, escape: sigil === "" });
    }
    match = TAG.exec(template);
  }
  if (cursor < template.length) {
    children.push({ kind: "text", value: template.slice(cursor) });
  }
  if (stack.length > 0) {
    throw new TemplateError(`Unclosed {{#${stack[stack.length - 1].name}}}.`);
  }
  return root;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mustache lookup: walk the context stack outward, then resolve dotted names. */
function lookup(stack: readonly unknown[], name: string): unknown {
  if (name === ".") {
    return stack[stack.length - 1];
  }
  const parts = name.split(".");
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i];
    if (!isRecord(frame) || !(parts[0] in frame)) {
      continue;
    }
    let value: unknown = frame[parts[0]];
    for (let p = 1; p < parts.length && value !== undefined && value !== null; p += 1) {
      value = isRecord(value) ? value[parts[p]] : undefined;
    }
    return value;
  }
  return undefined;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null || value === false) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringify).join("");
  }
  return String(value);
}

function isFalsy(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === "") {
    return true;
  }
  return Array.isArray(value) && value.length === 0;
}

function renderNodes(
  nodes: readonly Node[],
  stack: unknown[],
  partials: Readonly<Record<string, string>>,
  depth: number,
  maxDepth: number,
  cache: Map<string, Node[]>,
): string {
  if (depth > maxDepth) {
    throw new TemplateError(`Template recursion exceeded ${maxDepth} levels.`);
  }
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.value;
        break;
      case "var": {
        const raw = stringify(lookup(stack, node.name));
        out += node.escape ? escapeHtml(raw) : raw;
        break;
      }
      case "section": {
        const value = lookup(stack, node.name);
        if (node.inverted) {
          if (isFalsy(value)) {
            out += renderNodes(
              node.children,
              stack,
              partials,
              depth + 1,
              maxDepth,
              cache,
            );
          }
          break;
        }
        if (isFalsy(value)) {
          break;
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            stack.push(entry);
            out += renderNodes(
              node.children,
              stack,
              partials,
              depth + 1,
              maxDepth,
              cache,
            );
            stack.pop();
          }
        } else {
          stack.push(value);
          out += renderNodes(node.children, stack, partials, depth + 1, maxDepth, cache);
          stack.pop();
        }
        break;
      }
      case "partial": {
        const source = partials[node.name];
        if (source === undefined) {
          break; // absent partial renders as empty, per Mustache
        }
        let parsed = cache.get(node.name);
        if (parsed === undefined) {
          parsed = parseTemplate(source);
          cache.set(node.name, parsed);
        }
        out += renderNodes(parsed, stack, partials, depth + 1, maxDepth, cache);
        break;
      }
    }
  }
  return out;
}

/** Render a template against a context. Throws {@link TemplateError} on bad syntax. */
export function renderTemplate(
  template: string,
  context: TemplateContext,
  options: RenderOptions = {},
): string {
  const nodes = parseTemplate(template);
  return renderNodes(
    nodes,
    [context],
    options.partials ?? {},
    0,
    options.maxDepth ?? 64,
    new Map<string, Node[]>(),
  );
}
