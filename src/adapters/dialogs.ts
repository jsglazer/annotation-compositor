/**
 * Thin wrappers over the XPCOM prompt service.
 *
 * Kept in one adapter so the panel and the reader menu never touch XPCOM
 * directly, and so the InOutParam boxing lives in exactly one place.
 */

function parent(): mozIDOMWindowProxy | null {
  const window = Zotero.getMainWindow();
  return window === null ? null : (window as unknown as mozIDOMWindowProxy);
}

/** Ask for a single line of text. Returns `null` when the user cancels. */
export function promptText(title: string, message: string, initial = ""): string | null {
  const window = parent();
  if (window === null) {
    return null;
  }
  const value = { value: initial };
  const check = { value: false };
  const accepted = Services.prompt.prompt(window, title, message, value, "", check);
  return accepted ? value.value : null;
}

/**
 * Ask for a line of text plus one checkbox — the prompt service has always
 * carried a checkbox slot, so this needs no custom XUL dialog.
 * Returns `null` when the user cancels.
 */
export function promptTextChecked(
  title: string,
  message: string,
  initial: string,
  checkboxLabel: string,
  checkedInitial: boolean,
): { value: string; checked: boolean } | null {
  const window = parent();
  if (window === null) {
    return null;
  }
  const value = { value: initial };
  const check = { value: checkedInitial };
  const accepted = Services.prompt.prompt(
    window,
    title,
    message,
    value,
    checkboxLabel,
    check,
  );
  return accepted ? { value: value.value, checked: check.value } : null;
}

/** Yes/no confirmation. Returns false when there is no window to prompt on. */
export function confirm(title: string, message: string): boolean {
  const window = parent();
  return window === null ? false : Services.prompt.confirm(window, title, message);
}

/** Single choice from a list. Returns the index, or `null` when cancelled. */
export function select(title: string, message: string, choices: string[]): number | null {
  const window = parent();
  if (window === null || choices.length === 0) {
    return null;
  }
  const out = { value: 0 };
  return Services.prompt.select(window, title, message, choices, out) ? out.value : null;
}

/** Informational alert. */
export function alert(title: string, message: string): void {
  const window = parent();
  if (window !== null) {
    Services.prompt.alert(window, title, message);
  }
}
