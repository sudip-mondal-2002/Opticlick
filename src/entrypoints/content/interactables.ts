const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'radio', 'checkbox', 'tab', 'treeitem', 'gridcell',
  'combobox', 'listbox', 'slider', 'spinbutton', 'switch',
  'textbox', 'searchbox', 'columnheader', 'rowheader',
]);

const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'label',
  'summary', 'details', 'video', 'audio',
]);

export function isInteractable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') ?? '').toLowerCase();

  if (INTERACTIVE_TAGS.has(tag)) {
    if ((el as HTMLInputElement).disabled) return false;
    if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return false;
    return true;
  }

  if (INTERACTIVE_ROLES.has(role)) return true;

  if (el.hasAttribute('tabindex') && parseInt(el.getAttribute('tabindex') ?? '0', 10) >= 0)
    return true;

  try {
    if (window.getComputedStyle(el).cursor === 'pointer') return true;
  } catch { /* cross-origin */ }

  if (
    (el as HTMLElement).onclick ||
    el.hasAttribute('onclick') ||
    el.hasAttribute('ng-click') ||
    el.hasAttribute('@click') ||
    el.hasAttribute('v-on:click')
  )
    return true;

  return false;
}

/** Recursively collect interactables, piercing open Shadow DOMs. */
export function collectInteractables(root: Node, results: Element[] = []): Element[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    if (isInteractable(el)) results.push(el);
    const shadowRoot = (el as HTMLElement).shadowRoot;
    if (shadowRoot) {
      collectInteractables(shadowRoot, results);
    }
  }
  return results;
}

export function getLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim().slice(0, 40);

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ref = document.getElementById(ariaLabelledBy);
    if (ref) return (ref.textContent ?? '').trim().slice(0, 40);
  }

  if (tag === 'input') {
    return (
      (el as HTMLInputElement).placeholder ||
      (el as HTMLInputElement).name ||
      (el as HTMLInputElement).type ||
      'input'
    ).slice(0, 40);
  }

  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  if (text) return text.slice(0, 40);

  return tag;
}
