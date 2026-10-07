/**
 * The LaTeX preamble ("frontmatter") of a TeX export. Pure: no globals, no I/O.
 *
 * The preamble is a preference the user edits. It is NOT run through the
 * Mustache renderer — LaTeX is full of `{{` and `}}}`, which would collide with
 * Mustache tags — so it takes Pandoc-style `$title$` placeholders instead.
 */
import { escapeTex } from "./entryFormat.js";

/** Matches the Pandoc invocation the default preamble was written for. */
export const DEFAULT_DOCUMENT_CLASS = "\\documentclass[12pt,letterpaper]{article}";

/**
 * Default preamble: the user's own Pandoc `Pre.tex` (geometry, fancyhdr
 * header/footer with "page X of Y" and a date/time stamp), with the running
 * header title replaced by the exported item's title.
 *
 * Keep in step with `texPreamble` in addon/prefs.js (a test checks it).
 */
export const DEFAULT_TEX_PREAMBLE = [
  DEFAULT_DOCUMENT_CLASS,
  "\\usepackage[top=.75in, bottom=.75in, left=.75in, right=.75in, includehead, includefoot, marginparwidth=.75in, marginparsep=.125in]{geometry}",
  "\\setlength{\\parskip}{.15in}",
  "\\usepackage{hyperref}",
  "\\usepackage{graphicx}",
  "",
  "\\RequirePackage{datetime}",
  "\\settimeformat{ampmtime}",
  "\\newdateformat{dashdate}{\\THEYEAR-\\twodigit{\\THEMONTH}-\\twodigit{\\THEDAY}}",
  "\\newtimeformat{dottime}{\\twodigit{\\THEHOUR}:\\twodigit{\\THEMINUTE}:\\twodigit{\\THESECOND}}",
  "",
  "\\RequirePackage{lastpage}    %% Required for pages of page number",
  "\\RequirePackage{fancyhdr}   %must come after geometry",
  "\\pagestyle{fancy}",
  "\\renewcommand{\\sectionmark}[1]{\\markright{Sec.\\thesection:\\ #1}{}}",
  "\\fancyhead{} % clear all header fields",
  "\\fancyhead[L]{\\small{\\textbf{$title$}}}",
  "\\fancyhead[R]{\\small{Joshua S. Glazer}}",
  "\\fancyfoot{}",
  "\\fancyfoot[L]{\\scriptsize{\\thepage\\ of \\pageref{LastPage}}}",
  "\\fancyfoot[R]{\\scriptsize{\\dashdate{\\today} at \\dottime}}",
  "\\renewcommand{\\headrulewidth}{0.4pt}",
  "\\renewcommand{\\footrulewidth}{0.4pt}",
].join("\n");

/**
 * The preamble ready to write: `$title$` substituted (TeX-escaped), and a
 * `\documentclass` line supplied when the user's preamble leaves it out, so a
 * pasted Pandoc `-H` header file works as-is. A blank preference falls back to
 * the default.
 */
export function renderPreamble(preamble: string, title: string): string {
  const source = preamble.trim().length === 0 ? DEFAULT_TEX_PREAMBLE : preamble;
  const withClass = /^\s*\\documentclass\b/m.test(source)
    ? source
    : `${DEFAULT_DOCUMENT_CLASS}\n${source}`;
  return withClass.replace(/\$title\$/g, () => escapeTex(title)).replace(/\s+$/, "");
}
