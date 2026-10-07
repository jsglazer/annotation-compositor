/**
 * User-customisable one-line format for an exported annotation, plus the
 * colour-label filter and the per-format value escapers.
 * Pure: no globals, no I/O.
 *
 * Format syntax (deliberately small, so it can be typed into a preference):
 *
 * - `{text}`, `{page}`, `{label}`, `{comment}`, `{type}`, `{color}`,
 *   `{author}`, `{date}`, `{tags}`, `{index}` — the annotation's value.
 *   `{text}` falls back to `(type)` for annotations without text, as before.
 * - `{label, page}` — several names in one placeholder: the non-empty values
 *   joined by the separator written between the names (here ", ").
 * - `[ … ]` — an optional segment, dropped entirely when every placeholder
 *   inside it came out empty: `{text} ({label}[: {page}])`.
 * - `\[` and `\]` — literal brackets. Any `{word}` that is not a known name is
 *   left untouched, so TeX such as `\textbf{{label}}` works in a format.
 */

/** The values a format can reference, already unescaped. */
export interface EntryValues {
  readonly text: string;
  readonly page: string;
  readonly label: string;
  readonly comment: string;
  readonly type: string;
  readonly color: string;
  readonly author: string;
  readonly date: string;
  readonly tags: string;
  readonly index: string;
}

export type EscapeKind = "none" | "html" | "tex";

/** Reproduces the format every export used before formats were customisable. */
export const DEFAULT_ENTRY_FORMAT = "{text} ({label}[: {page}])";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const TEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  _: "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
};

/** Escape a value for LaTeX body text. */
export function escapeTex(value: string): string {
  return value.replace(/[\\{}$&#%_^~<>]/g, (char) => TEX_ESCAPES[char]);
}

export function escaperFor(kind: EscapeKind): (value: string) => string {
  switch (kind) {
    case "html":
      return (value) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
    case "tex":
      return escapeTex;
    case "none":
      return (value) => value;
  }
}

type Piece =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "field"; readonly names: string[]; readonly separator: string }
  | { readonly kind: "optional"; readonly children: Piece[] };

const FIELD_NAMES = new Set([
  "text",
  "page",
  "label",
  "comment",
  "type",
  "color",
  "author",
  "date",
  "tags",
  "index",
]);

/** `{a}` or `{a, b}` / `{a - b}`: known names separated by a constant separator. */
const FIELD = /^\{\s*([a-z]+)((?:\s*[^\w\s{}[\]]*\s*[a-z]+)*)\s*\}/;

function parseField(source: string): { piece: Piece; length: number } | null {
  const match = FIELD.exec(source);
  if (match === null) {
    return null;
  }
  const names = [match[1]];
  let separator = "";
  const rest = match[2];
  if (rest.length > 0) {
    const parts = rest.split(/([a-z]+)/).filter((part) => part.length > 0);
    // parts alternate separator, name, separator, name…
    for (let i = 0; i < parts.length; i += 2) {
      if (i === 0) {
        separator = parts[i];
      } else if (parts[i] !== separator) {
        return null; // mixed separators: not a placeholder, leave it literal
      }
      names.push(parts[i + 1]);
    }
  }
  if (!names.every((name) => FIELD_NAMES.has(name))) {
    return null;
  }
  return { piece: { kind: "field", names, separator }, length: match[0].length };
}

function parsePieces(source: string): Piece[] {
  const root: Piece[] = [];
  const stack: Piece[][] = [];
  let current = root;
  let literal = "";
  const flush = (): void => {
    if (literal.length > 0) {
      current.push({ kind: "text", value: literal });
      literal = "";
    }
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\" && (source[i + 1] === "[" || source[i + 1] === "]")) {
      literal += source[i + 1];
      i += 2;
      continue;
    }
    if (char === "[") {
      flush();
      const optional: Piece = { kind: "optional", children: [] };
      current.push(optional);
      stack.push(current);
      current = optional.children;
      i += 1;
      continue;
    }
    if (char === "]" && stack.length > 0) {
      flush();
      current = stack.pop() ?? root;
      i += 1;
      continue;
    }
    if (char === "{") {
      const field = parseField(source.slice(i));
      if (field !== null) {
        flush();
        current.push(field.piece);
        i += field.length;
        continue;
      }
    }
    literal += char;
    i += 1;
  }
  flush();
  // An unclosed `[` is a typo; render what it holds rather than losing it.
  return root;
}

function renderPieces(
  pieces: readonly Piece[],
  values: EntryValues,
  escape: (value: string) => string,
): { out: string; filled: boolean } {
  let out = "";
  let filled = false;
  for (const piece of pieces) {
    if (piece.kind === "text") {
      out += piece.value;
    } else if (piece.kind === "field") {
      const parts = piece.names
        .map((name) => values[name as keyof EntryValues])
        .filter((value) => value.length > 0);
      if (parts.length > 0) {
        filled = true;
        out += parts.map(escape).join(piece.separator);
      }
    } else {
      const inner = renderPieces(piece.children, values, escape);
      if (inner.filled) {
        filled = true;
        out += inner.out;
      }
    }
  }
  return { out, filled };
}

/**
 * Render one annotation through a format. Placeholder values are escaped for
 * the output format; the literal text of the format is written as typed.
 */
export function formatEntry(
  format: string,
  values: EntryValues,
  escape: EscapeKind = "none",
): string {
  const source = format.trim().length === 0 ? DEFAULT_ENTRY_FORMAT : format;
  return renderPieces(parsePieces(source), values, escaperFor(escape)).out;
}

/** Whether a format already shows the comment, so templates skip their own comment line. */
export function formatShowsComment(format: string): boolean {
  const source = format.trim().length === 0 ? DEFAULT_ENTRY_FORMAT : format;
  const visit = (pieces: readonly Piece[]): boolean =>
    pieces.some(
      (piece) =>
        (piece.kind === "field" && piece.names.includes("comment")) ||
        (piece.kind === "optional" && visit(piece.children)),
    );
  return visit(parsePieces(source));
}

export type LabelFilterMode = "off" | "include" | "exclude";

export interface LabelFilter {
  readonly mode: LabelFilterMode;
  /** Colour labels, matched case-insensitively. */
  readonly labels: readonly string[];
}

/** Split the comma-separated preference into trimmed, non-empty labels. */
export function parseLabelList(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

export function normalizeLabelFilterMode(raw: string): LabelFilterMode {
  return raw === "include" || raw === "exclude" ? raw : "off";
}

/**
 * Whether an annotation passes the filter. `labels` are the names it answers
 * to — its custom label and its built-in colour name — so "Yellow" keeps
 * matching after Enhanced Notes renames Yellow. An include filter with no
 * labels listed passes everything rather than exporting nothing.
 */
export function passesLabelFilter(
  filter: LabelFilter | undefined,
  labels: readonly string[],
): boolean {
  if (filter === undefined || filter.mode === "off" || filter.labels.length === 0) {
    return true;
  }
  const wanted = new Set(filter.labels.map((label) => label.toLowerCase()));
  const hit = labels.some((label) => wanted.has(label.toLowerCase()));
  return filter.mode === "include" ? hit : !hit;
}
