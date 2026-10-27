import { ROOM_SETUP_HREF } from './room-labels';

/** Marks the header's Room setup link, where focus returns when no opener is left. */
export const ROOM_SETUP_HOME = 'data-room-setup-home';

/** Marks the Room title, where focus goes when the sheet is taken away while open. */
export const ROOM_TITLE = 'data-room-title';

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
  // Room sync replaces nodes: one no longer on the page is not held.
  for (const node of held) if (!node.isConnected) held.delete(node);
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
 * A plain primary click: a modified or middle click opens the link in a new
 * tab or window, not the sheet, so it never becomes the opener.
 */
const openingClick = (event: Event): boolean => {
  const click = event as Partial<MouseEvent>;
  return (
    !click.ctrlKey &&
    !click.metaKey &&
    !click.shiftKey &&
    !click.altKey &&
    (click.button ?? 0) === 0
  );
};

/** Whether the sheet shows: its fragment is the URL's, or a refused save is on it. */
export function sheetOpen(hash: string, refused: boolean): boolean {
  return hash === ROOM_SETUP_HREF || refused;
}

/**
 * The open sheet's modal behaviour, framework-free so it is tested as wired:
 * while it is open the rest of the page is inert, content mounted anywhere
 * in the body behind it included, so focus and assistive technology stay in
 * it; opening moves focus to its heading and closing returns it to the link
 * that opened it. The returned stop lets everything go; a sheet taken away
 * while open (the round started elsewhere) sends focus to the Room title.
 */
export function modalSheet({
  window,
  sheet,
  heading,
}: {
  readonly window: Window;
  readonly sheet: HTMLElement;
  readonly heading: () => HTMLElement | null;
}): () => void {
  const document = sheet.ownerDocument;
  const held = new Set<HTMLElement>();
  let opener: HTMLElement | null = null;
  let wasOpen = false;
  const sync = () => {
    const open = sheetOpen(
      window.location.hash,
      sheet.querySelector('[role="alert"]') !== null,
    );
    if (open) holdInert(sheet, held);
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      opener = setupOpener(document.activeElement) ?? opener;
      heading()?.focus();
      return;
    }
    releaseInert(held);
    returnTarget(document, opener)?.focus();
    opener = null;
  };
  const remember = (event: Event) => {
    if (openingClick(event)) opener = setupOpener(event.target) ?? opener;
  };
  sync();
  const observer = new window.MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', remember, true);
  document.addEventListener('auxclick', remember, true);
  window.addEventListener('hashchange', sync);
  return () => {
    observer.disconnect();
    document.removeEventListener('click', remember, true);
    document.removeEventListener('auxclick', remember, true);
    window.removeEventListener('hashchange', sync);
    releaseInert(held);
    if (wasOpen)
      document.querySelector<HTMLElement>(`[${ROOM_TITLE}]`)?.focus();
  };
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
