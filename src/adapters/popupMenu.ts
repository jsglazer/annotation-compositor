/**
 * Cursor-anchored popup menu (a XUL `menupopup`), used in place of the
 * blocking `Services.prompt.select` modal for the panel's right-click menus.
 * Dismisses like every other Zotero context menu (outside click, Escape) and
 * removes itself from the document once closed.
 */
export interface PopupMenuItem {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onCommand?: () => void;
}

export function openPopupMenu(
  doc: Document,
  event: MouseEvent,
  items: readonly PopupMenuItem[],
): void {
  if (items.length === 0) {
    return;
  }
  const popup = doc.createXULElement("menupopup") as unknown as XULPopupElement;
  for (const item of items) {
    const menuitem = doc.createXULElement("menuitem");
    menuitem.setAttribute("label", item.label);
    if (item.disabled === true) {
      menuitem.setAttribute("disabled", "true");
    } else if (item.onCommand !== undefined) {
      const onCommand = item.onCommand;
      menuitem.addEventListener("command", () => onCommand());
    }
    popup.append(menuitem);
  }
  popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
  doc.documentElement.appendChild(popup);
  popup.openPopupAtScreen(event.screenX, event.screenY, true);
}
