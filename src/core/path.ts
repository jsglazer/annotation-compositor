/**
 * Tag-path grammar. Pure: no globals, no I/O.
 *
 * A group tag is `<prefix><SEP><segment>(<SEP><segment>)*`, e.g. `grp/Methods/Sampling`.
 * The separator is reserved: folder names may not contain it, there is no
 * escaping scheme, and tags stay human-readable.
 */
import type { FolderPath } from "./types.js";

export const PATH_SEPARATOR = "/";

/** Maximum folder depth below the prefix. */
export const MAX_DEPTH = 4;

export interface ValidationResult<T> {
  readonly ok: boolean;
  /** Present when `ok` is true. */
  readonly value?: T;
  /** Present when `ok` is false. */
  readonly error?: string;
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/**
 * Normalise a configured prefix: trimmed, no leading/trailing separators, no
 * empty result. The prefix itself may contain separators (`my/grp`), which lets
 * a user nest the whole hierarchy under an existing tag namespace.
 */
export function normalizePrefix(rawPrefix: string): ValidationResult<string> {
  const trimmed = rawPrefix.trim();
  const stripped = trimmed
    .split(PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(PATH_SEPARATOR);
  if (stripped.length === 0) {
    return fail("Tag prefix may not be empty.");
  }
  return ok(stripped);
}

/**
 * Validate a single folder name. Names are trimmed, case-sensitive, may not be
 * empty and may not contain the reserved separator.
 */
export function validateFolderName(rawName: string): ValidationResult<string> {
  const name = rawName.trim();
  if (name.length === 0) {
    return fail("Folder name may not be empty.");
  }
  if (name.includes(PATH_SEPARATOR)) {
    return fail(`Folder name may not contain "${PATH_SEPARATOR}".`);
  }
  return ok(name);
}

/**
 * Validate a whole path: every segment valid, depth within `MAX_DEPTH`.
 * Returns the trimmed segments on success.
 */
export function validatePath(segments: FolderPath): ValidationResult<string[]> {
  if (segments.length === 0) {
    return fail("Folder path may not be empty.");
  }
  if (segments.length > MAX_DEPTH) {
    return fail(`Folder path may not exceed ${MAX_DEPTH} levels below the prefix.`);
  }
  const cleaned: string[] = [];
  for (const segment of segments) {
    const result = validateFolderName(segment);
    if (!result.ok || result.value === undefined) {
      return fail(result.error ?? "Invalid folder name.");
    }
    cleaned.push(result.value);
  }
  return ok(cleaned);
}

/** Build the tag string for a path. Assumes the path has been validated. */
export function formatTag(prefix: string, segments: FolderPath): string {
  return [prefix, ...segments].join(PATH_SEPARATOR);
}

/** Join path segments into the stable key used by the view model and UI state. */
export function pathKey(segments: FolderPath): string {
  return segments.join(PATH_SEPARATOR);
}

/** Split a key produced by {@link pathKey} back into segments. */
export function keyToPath(key: string): string[] {
  return key.length === 0 ? [] : key.split(PATH_SEPARATOR);
}

/** True when `tag` belongs to the prefix namespace (and is not the bare prefix). */
export function isGroupTag(tag: string, prefix: string): boolean {
  return parseTag(tag, prefix) !== null;
}

/**
 * Parse a tag into its path segments below the prefix, or `null` when the tag
 * is not a group tag. Segments are returned verbatim except for trimming;
 * a tag with an empty segment (`grp//A`) is rejected as malformed.
 */
export function parseTag(tag: string, prefix: string): string[] | null {
  const head = `${prefix}${PATH_SEPARATOR}`;
  if (!tag.startsWith(head)) {
    return null;
  }
  const rest = tag.slice(head.length);
  if (rest.length === 0) {
    return null;
  }
  const segments = rest.split(PATH_SEPARATOR).map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }
  if (segments.length > MAX_DEPTH) {
    return null;
  }
  return segments;
}

/** All group paths on one tag list, in the order the tags were given. */
export function groupPaths(tags: readonly string[], prefix: string): string[][] {
  const paths: string[][] = [];
  for (const tag of tags) {
    const parsed = parseTag(tag, prefix);
    if (parsed !== null) {
      paths.push(parsed);
    }
  }
  return paths;
}

/** True when `path` equals `ancestor` or sits below it. */
export function isAtOrBelow(path: FolderPath, ancestor: FolderPath): boolean {
  if (path.length < ancestor.length) {
    return false;
  }
  for (let i = 0; i < ancestor.length; i += 1) {
    if (path[i] !== ancestor[i]) {
      return false;
    }
  }
  return true;
}

/** True when `path` sits strictly below `ancestor`. */
export function isBelow(path: FolderPath, ancestor: FolderPath): boolean {
  return path.length > ancestor.length && isAtOrBelow(path, ancestor);
}

/** The parent path, or `[]` for a root-level folder. */
export function parentPath(path: FolderPath): string[] {
  return path.slice(0, Math.max(0, path.length - 1));
}

/** Deterministic ordering for paths: segment-wise, case-sensitive. */
export function comparePaths(a: FolderPath, b: FolderPath): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length - b.length;
}
