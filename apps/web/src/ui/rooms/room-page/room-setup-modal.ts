import { ROOM_SETUP_HREF } from './room-labels';

/** Marks the header's Room setup link, where focus returns when no opener is left. */
export const ROOM_SETUP_HOME = 'data-room-setup-home';

const openerSelector = `a[href="${ROOM_SETUP_HREF}"]`;

/** The Room setup link an event came from or through; null for any other. */
export function setupOpener(target: EventTarget | null): HTMLElement | null {
  const element = target as Partial<Element> | null;
  return (element?.closest?.(openerSelector) as HTMLElement | null) ?? null;
}

/**
 * Where focus goes when the sheet closes: the link that opened it while it
 * is still on the page, else the header's Room setup link, else any.
 */
export function returnTarget(
  document: Document,
  opener: HTMLElement | null,
): HTMLElement | null {
  if (opener?.isConnected) return opener;
  return (
    document.querySelector<HTMLElement>(`[${ROOM_SETUP_HOME}]`) ??
    document.querySelector<HTMLElement>(openerSelector)
  );
}

/** An element that can be made inert; read structurally so any window's elements pass. */
const inertable = (element: Element): element is HTMLElement =>
  'inert' in element;

/** Every element beside the sheet and its ancestors, up to the body. */
function outside(sheet: HTMLElement): readonly HTMLElement[] {
  const body = sheet.ownerDocument.body;
  const elements: HTMLElement[] = [];
  for (let node: HTMLElement = sheet; node.parentElement;) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of parent.children)
      if (sibling !== node && inertable(sibling)) elements.push(sibling);
    if (parent === body) break;
    node = parent;
  }
  return elements;
}

/**
 * Makes everything beside the open sheet inert, content mounted after it
 * opened included, and records what it changed so release restores only
 * that. Elements already inert for another reason are left alone.
 */
export function holdInert(sheet: HTMLElement, held: Set<HTMLElement>): void {
  for (const node of outside(sheet)) {
    if (node.inert) continue;
    node.inert = true;
    held.add(node);
  }
}

/** Lifts the inertness `holdInert` set, and nothing else. */
export function releaseInert(held: Set<HTMLElement>): void {
  for (const node of held) node.inert = false;
  held.clear();
}

/**
 * How the sheet closes: dropping the fragment, or, while a refused save is
 * on it, navigating back to the room so the refusal clears with it.
 */
export function dismissal(sheet: HTMLElement | null): 'fragment' | 'navigate' {
  return sheet?.querySelector('[role="alert"]') ? 'navigate' : 'fragment';
}

/** A field's native invalid event opens the disclosure that hides it. */
export function openOnInvalid(event: {
  readonly currentTarget: HTMLDetailsElement;
}): void {
  event.currentTarget.open = true;
}
